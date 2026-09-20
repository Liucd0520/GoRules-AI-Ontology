"""最小 demo：在 Python 中直接使用 ZEN 引擎求解决策

演示三种用法：
  1. 库方式（最常用）：加载规则文件 → evaluate
  2. 规则热更新：改文件后重建 engine 即生效
  3. 批量求值：一次跑多组输入
"""

import sys
from pathlib import Path

import zen

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

RULES_DIR = Path(__file__).resolve().parent.parent / "rules"


def make_engine() -> zen.ZenEngine:
    def loader(key: str) -> str:
        return (RULES_DIR / key).read_text(encoding="utf-8")

    return zen.ZenEngine({"loader": loader})


def main() -> None:
    engine = make_engine()

    # ---- 1. 单次求值：运费规则 ----
    result = engine.evaluate("shipping-fee.json", {
        "customer": {"tier": "vip", "years": 3},
        "order": {"total": 800},
        "cart": {"weight": 12},
    })
    r = result["result"]
    print("== 运费规则（VIP / 订单800 / 12kg）==")
    print(f"  命中: 运费={r['shippingFee']} 折扣={r['discount']} 实付={r['finalFeeText']} (耗时 {result['performance']})")

    # ---- 2. Switch 分流：客户评分 ----
    for years, spend in [(6, 3000), (4, 1500), (1, 100)]:
        result = engine.evaluate("customer-score.json", {"customer": {"years": years, "monthlySpend": spend}})
        r = result["result"]
        print(f"== 客户评分（{years}年 / 月消费{spend}）==>")
        print(f"  等级={r['level']} 评分={r['score']} 券={r['coupon']}")

    # ---- 3. 批量求值 ----
    print("== 批量求值 ==")
    orders = [
        {"customer": {"tier": "normal"}, "order": {"total": 100}, "cart": {"weight": 30}},
        {"customer": {"tier": "normal"}, "order": {"total": 2000}, "cart": {"weight": 5}},
        {"customer": {"tier": "vip"}, "order": {"total": 300}, "cart": {"weight": 8}},
    ]
    for ctx in orders:
        r = engine.evaluate("shipping-fee.json", ctx)["result"]
        print(f"  订单{ctx['order']['total']}元/{ctx['cart']['weight']}kg -> 实付 {r['finalFeeText']}")


if __name__ == "__main__":
    main()
