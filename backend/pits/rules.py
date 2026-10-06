"""鞣坑门槛：放液看酸碱带（3.5～5.0），注液改鞣制看转速卡（8～14 转/分）。"""

from pits.models import Pit

MIN_PH = 3.5
MAX_PH = 5.0
MIN_RPM = 8
MAX_RPM = 14


class RuleError(ValueError):
    pass


def latest_ph(pit: Pit) -> float | None:
    sample = pit.samples.order_by("-taken_at", "-id").first()
    return None if sample is None else sample.ph


def qualified_drum_card(pit: Pit):
    """该坑未作废且转数落在 8～14（含）的转速卡，取最近一张。"""
    return (
        pit.drum_cards.filter(voided_at__isnull=True, rpm__gte=MIN_RPM, rpm__lte=MAX_RPM)
        .order_by("-measured_at", "-id")
        .first()
    )


def assert_can_set_status(pit: Pit, new_status: str) -> None:
    allowed = {Pit.STATUS_FILL, Pit.STATUS_TANNING, Pit.STATUS_DRAINED}
    if new_status not in allowed:
        raise RuleError(f"无效状态：{new_status}")
    if new_status == Pit.STATUS_TANNING and pit.status == Pit.STATUS_FILL:
        if not pit.drum_cards.filter(voided_at__isnull=True).exists():
            raise RuleError("该坑尚无未作废的转速卡，不能改成鞣制中")
        if qualified_drum_card(pit) is None:
            raise RuleError(f"转速卡转数不在 {MIN_RPM}～{MAX_RPM} 转/分，不能改成鞣制中")
    if new_status == Pit.STATUS_DRAINED:
        # 已放液只认酸碱带，转速卡不参与
        ph = latest_ph(pit)
        if ph is None:
            raise RuleError("该坑尚无浸液酸碱记录，不能放液")
        if ph < MIN_PH or ph > MAX_PH:
            raise RuleError(f"最近酸碱度 {ph} 不在 {MIN_PH}～{MAX_PH}，不能放液")
