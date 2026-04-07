# Implementation Plan: Comprehensive Dashboard

## Overview

Transform the existing AgriTech dashboard into a data-rich, production-quality dashboard with Recharts-based time-series charts, expanded mock data, new domain widgets (Weather, Crop Health, Robot Fleet), and NVIDIA Isaac Sim integration. Implementation proceeds backend-first (new endpoints and mock data), then frontend types and shared utilities, then individual widget components, and finally wiring everything into the layout and routes.

## Tasks

- [x] 1. Backend: Add time-series and trends endpoints to farms router
  - [x] 1.1 Add `/farms/sensors/timeseries` and `/farms/trends` endpoints
    - Add `TimeSeriesPoint`, `SensorTimeSeries`, `TimeSeriesResponse`, `TrendPoint`, `MetricTrend`, `TrendsResponse` Pydantic models to `packages/backend/app/api/farms.py`
    - Implement mock data generator for 24h of sensor readings at 30-min intervals (temperature, humidity, soil_moisture, light) with realistic ranges
    - Implement mock data generator for 12 hourly trend points per metric
    - Add `GET /farms/sensors/timeseries` endpoint with `sensor_type` and `hours` query params (hours: 1-168, default 24)
    - Add `GET /farms/trends` endpoint returning sparkline data
    - _Requirements: 1.2, 1.4, 2.2, 2.3_

  - [x]* 1.2 Write property tests for time-series and trends mock data (backend)
    - **Property 1: Time-series data interval consistency** — verify point count = hours*2 and consecutive timestamps differ by 30 min
    - **Property 4: Mock sensor data falls within realistic agricultural ranges** — verify temperature ∈ [20,35], humidity ∈ [50,90], soil moisture ∈ [30,70]
    - **Validates: Requirements 1.2, 1.4, 2.3**

- [x] 2. Backend: Expand alerts mock data and add severity sorting
  - [x] 2.1 Expand mock alerts and sort by severity
    - Add at least 8 mock alerts to `packages/backend/app/api/farms.py` covering pest detection, irrigation failures, temperature extremes, equipment malfunctions, soil nutrient deficiencies, and weather warnings
    - Update `get_alerts` endpoint to return alerts sorted by severity (critical → warning → info)
    - _Requirements: 3.1, 3.2, 3.3_

  - [x]* 2.2 Write property test for alert severity sorting (backend)
    - **Property 5: Alerts are sorted by severity** — for any list of alerts with mixed severities, after sorting, critical before warning before info
    - **Validates: Requirements 3.3**

- [x] 3. Backend: Add weather router with current and forecast endpoints
  - [x] 3.1 Create weather router with mock data
    - Create `packages/backend/app/api/weather.py` with `CurrentWeather`, `DailyForecast`, `CurrentWeatherResponse`, `ForecastResponse` models
    - Implement mock current weather data (tropical Singapore climate) and 5-day forecast
    - Add `GET /weather/current` and `GET /weather/forecast` endpoints
    - Register weather router in `packages/backend/app/api/router.py`
    - _Requirements: 4.1, 4.2, 4.3, 4.4_

  - [x]* 3.2 Write property test for weather data ranges (backend)
    - **Property 7: Mock weather data is consistent with tropical region** — verify temp ∈ [24,36], humidity ∈ [55,95]
    - **Validates: Requirements 4.4**

- [x] 4. Backend: Add crops router with health endpoint
  - [x] 4.1 Create crops router with mock data
    - Create `packages/backend/app/api/crops.py` with `HealthStatus`, `ZoneCropHealth`, `CropHealthResponse` models
    - Implement mock crop health data for 6 farm zones with varied statuses and crop types
    - Add `GET /crops/health` endpoint
    - Register crops router in `packages/backend/app/api/router.py`
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

- [x] 5. Backend: Add robots router with fleet endpoint
  - [x] 5.1 Create robots router with mock data
    - Create `packages/backend/app/api/robots.py` with `RobotType`, `RobotStatus`, `Robot`, `RobotStatusSummary`, `RobotFleetResponse` models
    - Implement mock data for 6 robots with varied types and statuses
    - Compute summary counts from robot list
    - Add `GET /robots/fleet` endpoint
    - Register robots router in `packages/backend/app/api/router.py`
    - _Requirements: 8.1, 8.2, 8.3, 8.4_

  - [x]* 5.2 Write property test for robot fleet summary counts (backend)
    - **Property 12: Robot fleet summary counts match data** — verify summary counts equal the count of robots with each status
    - **Validates: Requirements 8.2**

- [x] 6. Backend: Add simulation scenarios endpoint
  - [x] 6.1 Add `/simulations/scenarios` endpoint
    - Add `SimulationScenario`, `ScenariosResponse` models to `packages/backend/app/api/simulations.py`
    - Implement mock data for 4 agricultural robotics scenarios (crop inspection drone, autonomous harvester path, pest patrol rover, irrigation monitoring drone)
    - Add `GET /simulations/scenarios` endpoint
    - _Requirements: 10.1, 10.2_

- [x] 7. Checkpoint — Backend complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Frontend: Add Recharts dependency and shared TypeScript types
  - [x] 8.1 Install Recharts and define shared types
    - Add `recharts` to `packages/frontend/package.json` dependencies
    - Create `packages/frontend/src/types/dashboard.ts` with all new TypeScript interfaces: `TimeSeriesPoint`, `SensorTimeSeries`, `TimeSeriesResponse`, `TrendPoint`, `MetricTrend`, `TrendsResponse`, `CurrentWeather`, `DailyForecast`, `CurrentWeatherResponse`, `ForecastResponse`, `ZoneCropHealth`, `CropHealthResponse`, `Robot`, `RobotStatusSummary`, `RobotFleetResponse`, `IsaacSimConfig`, `ConnectionStatus`, `SimulationScenario`, `ScenariosResponse`
    - _Requirements: 1.1, 2.1, 4.1, 5.1, 6.1, 8.1, 10.1_

- [x] 9. Frontend: Implement SparklineCard and DashboardOverview
  - [x] 9.1 Create SparklineCard component
    - Create `packages/frontend/src/features/dashboard/SparklineCard.tsx`
    - Render a metric card with label, value, unit, and an embedded Recharts `AreaChart` sparkline
    - Accept props: `label`, `value`, `unit`, `data` (array of trend points), `color`
    - _Requirements: 2.1_

  - [x] 9.2 Create DashboardOverview component
    - Create `packages/frontend/src/features/dashboard/DashboardOverview.tsx`
    - Fetch from `/api/farms/trends` using TanStack Query
    - Render 4 SparklineCard components in a responsive grid (temperature, humidity, soil moisture, active alerts)
    - Include a mini sensor trend chart, recent alerts summary, and weather widget in a two-column responsive grid below the cards
    - Show loading skeletons and ErrorRetry on error
    - _Requirements: 2.1, 9.1, 9.4_

  - [x]* 9.3 Write property test for sparkline card rendering
    - **Property 3: Sparkline card renders trend data for all metrics** — for any valid trends response, verify a sparkline card is rendered for each metric
    - **Validates: Requirements 2.1**

- [x] 10. Frontend: Implement SensorTimeSeriesChart (Analytics page)
  - [x] 10.1 Create SensorTimeSeriesChart component
    - Create `packages/frontend/src/features/dashboard/SensorTimeSeriesChart.tsx`
    - Fetch from `/api/farms/sensors/timeseries` using TanStack Query
    - Render a Recharts `LineChart` with a line for each sensor type, tooltip with value/unit/timestamp, and legend
    - Show loading skeleton and ErrorRetry on error
    - _Requirements: 1.1, 1.3, 1.5_

  - [x]* 10.2 Write property test for chart line count
    - **Property 2: Chart renders all sensor type lines** — for any response with N sensor types, verify N line series rendered
    - **Validates: Requirements 1.1**

- [x] 11. Frontend: Update AlertsWidget with severity sorting
  - [x] 11.1 Sort alerts by severity in AlertsWidget
    - Modify `packages/frontend/src/features/dashboard/AlertsWidget.tsx` to sort fetched alerts by severity: critical → warning → info
    - _Requirements: 3.3_

  - [x]* 11.2 Write property test for alert severity sorting (frontend)
    - **Property 5: Alerts are sorted by severity** — for any list of alerts with mixed severities, verify ordering invariant after sort
    - **Validates: Requirements 3.3**

- [x] 12. Frontend: Implement WeatherWidget
  - [x] 12.1 Create WeatherWidget component
    - Create `packages/frontend/src/features/dashboard/WeatherWidget.tsx`
    - Fetch from `/api/weather/current` and `/api/weather/forecast` using TanStack Query
    - Display current temperature, humidity, wind speed, condition
    - Display 5-day forecast cards with high/low temps and conditions
    - Show loading skeleton and ErrorRetry on error
    - _Requirements: 4.1, 4.2_

  - [x]* 12.2 Write property test for weather widget field completeness
    - **Property 6: Weather widget displays all required fields** — for any valid weather data, verify temperature, humidity, wind speed, and condition are rendered
    - **Validates: Requirements 4.1**

- [x] 13. Frontend: Implement CropHealthWidget
  - [x] 13.1 Create CropHealthWidget component
    - Create `packages/frontend/src/features/dashboard/CropHealthWidget.tsx`
    - Fetch from `/api/crops/health` using TanStack Query
    - Display zone list with health status badges (healthy/needs_attention/critical), crop type, growth stage, last inspection date
    - Show loading skeleton and ErrorRetry on error
    - _Requirements: 5.1, 5.2_

  - [x]* 13.2 Write property test for crop health zone completeness
    - **Property 8: Crop health zone data completeness** — for any valid zone data, verify health status, crop type, growth stage, and inspection date are rendered
    - **Validates: Requirements 5.1, 5.2**

- [x] 14. Frontend: Implement RobotFleetWidget
  - [x] 14.1 Create RobotFleetWidget component
    - Create `packages/frontend/src/features/dashboard/RobotFleetWidget.tsx`
    - Fetch from `/api/robots/fleet` using TanStack Query
    - Display summary count bar (active, idle, charging, maintenance)
    - Display robot list with name, type, status, assigned zone, battery level
    - Highlight maintenance robots with a warning indicator
    - Show loading skeleton and ErrorRetry on error
    - _Requirements: 8.1, 8.2, 8.5_

  - [x]* 14.2 Write property tests for robot fleet widget
    - **Property 13: Robot fleet displays all required fields** — for any valid robot data, verify name, type, status, and zone are rendered
    - **Property 14: Maintenance robots are highlighted** — for any robot list, verify warning indicator iff status = "maintenance"
    - **Validates: Requirements 8.1, 8.5**

- [x] 15. Frontend: Implement Isaac Sim Panel components
  - [x] 15.1 Create IsaacSimPanel with connection form and status indicator
    - Create `packages/frontend/src/features/dashboard/IsaacSimPanel.tsx`
    - Implement connection config form (host, port, streaming URL) with validation
    - Implement connection status indicator with color coding (gray=disconnected, yellow=connecting, green=connected, red=error)
    - Persist config to localStorage under key `isaac-sim-config`, restore on mount
    - Implement connection state machine: disconnected → connecting → connected/error
    - Show reconnect button on error, disconnect button when connected
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

  - [x] 15.2 Create IsaacSimViewport component
    - Create `packages/frontend/src/features/dashboard/IsaacSimViewport.tsx`
    - Render 16:9 aspect ratio viewport area
    - Show placeholder message when disconnected
    - Render iframe/video element pointing to streaming URL when connected
    - Include fullscreen toggle and quality selection controls (low, medium, high)
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

  - [x] 15.3 Create IsaacSimScenarioList component
    - Create `packages/frontend/src/features/dashboard/IsaacSimScenarioList.tsx`
    - Fetch from `/api/simulations/scenarios` using TanStack Query
    - Display scenario cards with name, description, robot type, estimated duration
    - Show scenario details and "Launch in Isaac Sim" button on selection
    - Show prompt to connect first if connection status is disconnected
    - _Requirements: 10.1, 10.3, 10.4_

  - [x]* 15.4 Write property tests for Isaac Sim components
    - **Property 9: Isaac Sim connection status indicator correctness** — for any status value, verify correct color class
    - **Property 10: Isaac Sim connection config validation** — for any host/port input, verify validation accepts iff host non-empty and port ∈ [1,65535]
    - **Property 11: Isaac Sim config localStorage round-trip** — for any valid config, verify serialize/deserialize produces equivalent object
    - **Property 15: Scenario list displays all required fields** — for any valid scenario data, verify name, description, robot type, and duration are rendered
    - **Validates: Requirements 6.2, 6.3, 6.5, 10.1**

- [x] 16. Checkpoint — All widgets implemented
  - Ensure all tests pass, ask the user if questions arise.

- [x] 17. Frontend: Wire everything into layout and routes
  - [x] 17.1 Update DashboardLayout navigation
    - Add nav items to `packages/frontend/src/features/dashboard/DashboardLayout.tsx` for Weather, Crop Health, Isaac Sim, and Robot Fleet using appropriate lucide-react icons
    - _Requirements: 9.3_

  - [x] 17.2 Update App.tsx routes and dashboard index
    - Add new routes in `packages/frontend/src/App.tsx`: `/dashboard/weather`, `/dashboard/crop-health`, `/dashboard/isaac-sim`, `/dashboard/robot-fleet`
    - Replace `MetricsOverview` with `DashboardOverview` as the dashboard index route
    - Replace `AnalyticsWidget` with `SensorTimeSeriesChart` for the analytics route
    - _Requirements: 9.1, 9.3, 9.4_

  - [x] 17.3 Implement responsive grid layout in DashboardOverview
    - Ensure DashboardOverview uses a responsive grid: metric cards row, then two-column layout for chart and secondary widgets
    - Stack to single column below 768px viewport width
    - _Requirements: 9.1, 9.2_

- [x] 18. Final checkpoint — Full integration complete
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Backend uses Python with FastAPI/Pydantic; frontend uses TypeScript with React/Recharts/TanStack Query
- fast-check is already installed for frontend property tests; hypothesis needed for backend property tests
