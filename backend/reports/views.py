"""Reports: what the week looked like, on screen and as a spreadsheet."""

from datetime import date as date_cls

from django.http import HttpResponse
from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.response import Response

from .data import DAILY, WEEKLY, build_report, filename_for, resolve_period
from .workbook import build_workbook

XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _read_request(request) -> tuple[str, date_cls | None, Response | None]:
    if not request.user.is_owner:
        return "", None, Response(
            {"detail": "Reports cover a whole team, so they are for owners."},
            status=status.HTTP_403_FORBIDDEN,
        )

    kind = (request.query_params.get("period") or DAILY).lower()
    if kind not in (DAILY, WEEKLY):
        return "", None, Response(
            {"detail": "period must be daily or weekly."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    raw = request.query_params.get("date")
    anchor = None
    if raw:
        try:
            anchor = date_cls.fromisoformat(str(raw)[:10])
        except ValueError:
            return "", None, Response(
                {"detail": "date must be YYYY-MM-DD."},
                status=status.HTTP_400_BAD_REQUEST,
            )
    return kind, anchor, None


@api_view(["GET"])
def preview(request):
    """The report as JSON, for the screen it is downloaded from.

    Same builder as the spreadsheet. Two code paths producing "the same" report
    is how the file ends up disagreeing with the page it came from, and the file
    is the copy that gets forwarded.
    """
    kind, anchor, refusal = _read_request(request)
    if refusal is not None:
        return refusal

    report = build_report(request.user, kind, anchor)
    period = report["period"]

    return Response({
        "period": {
            "kind": period.kind,
            "label": period.label,
            "start": period.start,
            "end": period.end,
            "days": len(period.days),
        },
        "filename": filename_for(period),
        "summary": report["summary"],
        "projects": report["projects"],
        "people": report["people"],
        "assignments": report["assignments"],
        "milestones": report["milestones"],
        "activity": report["activity"],
    })


@api_view(["GET"])
def export(request):
    """The same report as a .xlsx download."""
    kind, anchor, refusal = _read_request(request)
    if refusal is not None:
        return refusal

    report = build_report(request.user, kind, anchor)
    payload = build_workbook(report)

    response = HttpResponse(payload, content_type=XLSX)
    name = filename_for(report["period"])
    response["Content-Disposition"] = f'attachment; filename="{name}"'
    response["Content-Length"] = str(len(payload))
    # The browser reaches this through the Next proxy, which only relays headers
    # it knows about — this one is named there too.
    response["X-Report-Filename"] = name
    return response


@api_view(["GET"])
def windows(request):
    """The periods on offer, already resolved, so the screen can label them."""
    if not request.user.is_owner:
        return Response(
            {"detail": "Reports cover a whole team, so they are for owners."},
            status=status.HTTP_403_FORBIDDEN,
        )

    daily = resolve_period(DAILY)
    weekly = resolve_period(WEEKLY)
    return Response({
        "daily": {"kind": DAILY, "label": daily.label,
                  "start": daily.start, "end": daily.end},
        "weekly": {"kind": WEEKLY, "label": weekly.label,
                   "start": weekly.start, "end": weekly.end},
    })
