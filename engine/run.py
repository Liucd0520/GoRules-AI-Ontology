"""命令行求值工具

用法:
  python run.py <规则名或文件路径> [上下文JSON | @上下文文件]

示例:
  python run.py shipping-fee "{\"customer\":{\"tier\":\"vip\"},\"order\":{\"total\":800},\"cart\":{\"weight\":12}}"
  python run.py customer-score @ctx.json
"""

import json
import sys
from pathlib import Path

import zen

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

RULES_DIR = Path(__file__).resolve().parent.parent / "rules"


def load_context(arg: str) -> dict:
    if arg.startswith("@"):
        return json.loads(Path(arg[1:]).read_text(encoding="utf-8"))
    return json.loads(arg)


def main() -> None:
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        sys.exit(1)

    target = args[0]
    context = load_context(args[1]) if len(args) > 1 else {}

    def loader(key: str) -> str:
        p = (RULES_DIR / key).resolve()
        if not p.exists():
            raise FileNotFoundError(key)
        return p.read_text(encoding="utf-8")

    engine = zen.ZenEngine({"loader": loader})

    path = Path(target)
    if path.exists():
        result = engine.create_decision(path.read_text(encoding="utf-8")).evaluate(context)
    else:
        key = target if target.endswith(".json") else f"{target}.json"
        if not (RULES_DIR / key).exists():
            print(f"找不到规则: {target} (在 {RULES_DIR} 中也没有 {key})")
            sys.exit(1)
        result = engine.evaluate(key, context)

    print(json.dumps(result, ensure_ascii=False, indent=2, default=str))


if __name__ == "__main__":
    main()
