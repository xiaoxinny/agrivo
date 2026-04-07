"""Property-based tests for comprehensive dashboard backend logic.

Uses hypothesis to verify correctness properties across randomised inputs.
Each test runs with max_examples=100 and is tagged with the feature/property it validates.
"""

from __future__ import annotations

import os

# ── Set test env vars BEFORE any app code is imported ──────────────
os.environ.setdefault("SECRET_KEY", "test-secret-key-for-testing")
os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost:5432/test")
os.environ.setdefault("COGNITO_USER_POOL_ID", "ap-southeast-1_TestPool")
os.environ.setdefault("COGNITO_CLIENT_ID", "test-client-id")
os.environ.setdefault("COGNITO_DOMAIN", "test-app.auth.ap-southeast-1.amazoncognito.com")
os.environ.setdefault("COGNITO_REDIRECT_URI", "https://test.example.com/auth/callback")

from datetime import datetime, timedelta, timezone

from hypothesis import given, settings
from hypothesis import strategies as st

from app.api.farms import (
    Alert,
    AlertSeverity,
    SensorType,
    _SENSOR_RANGES,
    _generate_timeseries,
    sort_alerts_by_severity,
)
from app.api.robots import (
    Robot,
    RobotStatus,
    RobotType,
    _compute_summary,
)
from app.api.weather import _MOCK_CURRENT, _MOCK_FORECAST

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_BASE_TIME = datetime(2025, 1, 15, 10, 30, 0, tzinfo=timezone.utc)

_SEVERITY_RANK = {
    AlertSeverity.critical: 0,
    AlertSeverity.warning: 1,
    AlertSeverity.info: 2,
}

# ---------------------------------------------------------------------------
# Property 1: Time-series data interval consistency
# Feature: comprehensive-dashboard, Property 1: Time-series data interval consistency
# Validates: Requirements 1.2
# ---------------------------------------------------------------------------


@given(hours=st.integers(min_value=1, max_value=168))
@settings(max_examples=100)
def test_timeseries_interval_consistency(hours: int) -> None:
    """For any valid hours param, point count == hours*2 and intervals == 30 min."""
    for sensor_type in SensorType:
        series = _generate_timeseries(sensor_type, hours, _BASE_TIME)

        # Correct number of points
        assert len(series.points) == hours * 2, (
            f"Expected {hours * 2} points for {sensor_type}, got {len(series.points)}"
        )

        # Consecutive timestamps differ by exactly 30 minutes
        for i in range(1, len(series.points)):
            delta = series.points[i].timestamp - series.points[i - 1].timestamp
            assert delta == timedelta(minutes=30), (
                f"Expected 30-min gap at index {i} for {sensor_type}, got {delta}"
            )


# ---------------------------------------------------------------------------
# Property 4: Mock sensor data falls within realistic agricultural ranges
# Feature: comprehensive-dashboard, Property 4: Mock sensor data falls within realistic agricultural ranges
# Validates: Requirements 2.3
# ---------------------------------------------------------------------------


@given(hours=st.integers(min_value=1, max_value=168))
@settings(max_examples=100)
def test_sensor_data_within_ranges(hours: int) -> None:
    """All generated sensor values must stay within their defined ranges."""
    for sensor_type in (
        SensorType.temperature,
        SensorType.humidity,
        SensorType.soil_moisture,
    ):
        low, high, _ = _SENSOR_RANGES[sensor_type]
        series = _generate_timeseries(sensor_type, hours, _BASE_TIME)

        for pt in series.points:
            assert low <= pt.value <= high, (
                f"{sensor_type} value {pt.value} outside [{low}, {high}]"
            )


# ---------------------------------------------------------------------------
# Property 5: Alerts are sorted by severity
# Feature: comprehensive-dashboard, Property 5: Alerts are sorted by severity
# Validates: Requirements 3.3
# ---------------------------------------------------------------------------

_alert_strategy = st.lists(
    st.builds(
        Alert,
        alert_id=st.text(min_size=1, max_size=10).map(lambda s: f"alert-{s}"),
        severity=st.sampled_from(list(AlertSeverity)),
        message=st.text(min_size=1, max_size=50),
        timestamp=st.just(_BASE_TIME),
        acknowledged=st.booleans(),
    ),
    min_size=0,
    max_size=30,
)


@given(alerts=_alert_strategy)
@settings(max_examples=100)
def test_alerts_sorted_by_severity(alerts: list[Alert]) -> None:
    """After sorting, critical < warning < info in index order."""
    sorted_alerts = sort_alerts_by_severity(alerts)

    for i in range(1, len(sorted_alerts)):
        prev_rank = _SEVERITY_RANK[sorted_alerts[i - 1].severity]
        curr_rank = _SEVERITY_RANK[sorted_alerts[i].severity]
        assert prev_rank <= curr_rank, (
            f"Severity ordering violated at index {i}: "
            f"{sorted_alerts[i - 1].severity} (rank {prev_rank}) before "
            f"{sorted_alerts[i].severity} (rank {curr_rank})"
        )


# ---------------------------------------------------------------------------
# Property 7: Mock weather data is consistent with tropical region
# Feature: comprehensive-dashboard, Property 7: Mock weather data is consistent with tropical region
# Validates: Requirements 4.4
# ---------------------------------------------------------------------------


def test_mock_current_weather_tropical_ranges() -> None:
    """Current weather mock data must be within tropical Singapore ranges."""
    assert 24 <= _MOCK_CURRENT.temperature <= 36, (
        f"Current temp {_MOCK_CURRENT.temperature} outside [24, 36]"
    )
    assert 55 <= _MOCK_CURRENT.humidity <= 95, (
        f"Current humidity {_MOCK_CURRENT.humidity} outside [55, 95]"
    )


def test_mock_forecast_tropical_ranges() -> None:
    """All forecast entries must have temps and humidity within tropical ranges."""
    for entry in _MOCK_FORECAST:
        assert 24 <= entry.high <= 36, (
            f"Forecast high {entry.high} outside [24, 36]"
        )
        assert 24 <= entry.low <= 36, (
            f"Forecast low {entry.low} outside [24, 36]"
        )
        assert 55 <= entry.humidity <= 95, (
            f"Forecast humidity {entry.humidity} outside [55, 95]"
        )


# ---------------------------------------------------------------------------
# Property 12: Robot fleet summary counts match data
# Feature: comprehensive-dashboard, Property 12: Robot fleet summary counts match data
# Validates: Requirements 8.2
# ---------------------------------------------------------------------------

_robot_strategy = st.lists(
    st.builds(
        Robot,
        robot_id=st.text(min_size=1, max_size=10).map(lambda s: f"robot-{s}"),
        name=st.text(min_size=1, max_size=20),
        type=st.sampled_from(list(RobotType)),
        status=st.sampled_from(list(RobotStatus)),
        assigned_zone=st.text(min_size=1, max_size=20),
        battery_level=st.integers(min_value=0, max_value=100),
    ),
    min_size=0,
    max_size=30,
)


@given(robots=_robot_strategy)
@settings(max_examples=100)
def test_robot_fleet_summary_counts(robots: list[Robot]) -> None:
    """Summary counts must exactly match the number of robots with each status."""
    summary = _compute_summary(robots)

    expected_active = sum(1 for r in robots if r.status == RobotStatus.active)
    expected_idle = sum(1 for r in robots if r.status == RobotStatus.idle)
    expected_charging = sum(1 for r in robots if r.status == RobotStatus.charging)
    expected_maintenance = sum(1 for r in robots if r.status == RobotStatus.maintenance)

    assert summary.active == expected_active, (
        f"Active: expected {expected_active}, got {summary.active}"
    )
    assert summary.idle == expected_idle, (
        f"Idle: expected {expected_idle}, got {summary.idle}"
    )
    assert summary.charging == expected_charging, (
        f"Charging: expected {expected_charging}, got {summary.charging}"
    )
    assert summary.maintenance == expected_maintenance, (
        f"Maintenance: expected {expected_maintenance}, got {summary.maintenance}"
    )
