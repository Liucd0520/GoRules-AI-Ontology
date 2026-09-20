"""ZEN 规则引擎 - Python 驱动服务

从 ../rules 目录加载 JDM 决策文件并提供 REST 求值接口。
启动: uvicorn app:app --host 0.0.0.0 --port 8800
"""

import json
from pathlib import Path
from typing import Any, Optional, Union

import zen
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

RULES_DIR = Path(__file__).resolve().parent.parent / "rules"

app = FastAPI(title="ZEN Rules Engine (Python)", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def _loader(key: str) -> str:
    """按 key 读取规则文件，供 decisionNode 子决策引用时使用"""
    p = (RULES_DIR / key).resolve()
    if not p.is_relative_to(RULES_DIR.resolve()):
        raise FileNotFoundError(key)
    if not p.exists():
        raise FileNotFoundError(key)
    return p.read_text(encoding="utf-8")


engine = zen.ZenEngine({"loader": _loader})


class EvaluateRequest(BaseModel):
    context: Optional[Union[dict[str, Any], list[Any]]] = None


def _rule_key(name: str) -> str:
    key = name if name.endswith(".json") else f"{name}.json"
    if ".." in key or "/" in key or "\\" in key:
        raise HTTPException(status_code=400, detail="非法规则名")
    return key


@app.get("/api/decisions")
def list_decisions():
    RULES_DIR.mkdir(parents=True, exist_ok=True)
    return [{"name": f.name} for f in sorted(RULES_DIR.glob("*.json")) if f.name != "ontology.json"]


@app.get("/api/decisions/{name}/content")
def get_content(name: str):
    key = _rule_key(name)
    p = RULES_DIR / key
    if not p.exists():
        raise HTTPException(status_code=404, detail=f"规则不存在: {key}")
    return json.loads(p.read_text(encoding="utf-8"))


@app.post("/api/decisions/{name}/evaluate")
def evaluate_decision(name: str, req: EvaluateRequest):
    key = _rule_key(name)
    if not (RULES_DIR / key).exists():
        raise HTTPException(status_code=404, detail=f"规则不存在: {key}")
    try:
        result = engine.evaluate(key, req.context or {})
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"求值失败: {e}") from e
    if isinstance(result, dict):
        return result
    return {"result": result}


@app.post("/api/evaluate")
def evaluate_by_key(req: dict[str, Any]):
    """直接按 key 求值: {"key": "shipping-fee.json", "context": {...}}"""
    key = str(req.get("key") or "")
    if not key:
        raise HTTPException(status_code=400, detail="缺少 key")
    context = req.get("context") or {}
    try:
        result = engine.evaluate(_rule_key(key), context)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"求值失败: {e}") from e
    if isinstance(result, dict):
        return result
    return {"result": result}


@app.get("/health")
def health():
    return {"status": "ok", "engine": "zen-engine (python)", "rules_dir": str(RULES_DIR)}
