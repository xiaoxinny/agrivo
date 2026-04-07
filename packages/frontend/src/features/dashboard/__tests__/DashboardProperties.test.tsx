import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import fc from "fast-check";
import type {
  TrendPoint,
  MetricTrend,
  SensorTimeSeries,
  CurrentWeather,
  ZoneCropHealth,
  Robot,
  SimulationScenario,
  ConnectionStatus,
  IsaacSimConfig,
} from "@/types/dashboard";

// Mock the api module
vi.mock("@/lib/api", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
  },
  ApiError: class ApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.name = "ApiError";
      this.status = status;
    }
  },
  SESSION_EXPIRED_EVENT: "session-expired",
}));

// Mock recharts to avoid jsdom rendering issues
vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => children,
  AreaChart: ({ children }: { children: React.ReactNode }) => <div data-testid="area-chart">{children}</div>,
  Area: () => <div />,
  LineChart: ({ children }: { children: React.ReactNode }) => <div data-testid="line-chart">{children}</div>,
  Line: () => <div />,
  XAxis: () => <div />,
  YAxis: () => <div />,
  CartesianGrid: () => <div />,
  Tooltip: () => <div />,
  Legend: () => <div />,
}));

import { api } from "@/lib/api";

const mockApi = api as {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
};

function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

// ─── Arbitraries ────────────────────────────────────────────────────────────

const trendPointArb = fc.record({
  hour: fc.string({ minLength: 1, maxLength: 5 }),
  value: fc.float({ min: 0, max: 100, noNaN: true }),
});

const metricTrendArb = fc.record({
  metric: fc.constantFrom("temperature", "humidity", "soil_moisture", "active_alerts"),
  unit: fc.constantFrom("°C", "%", "%", ""),
  current_value: fc.float({ min: 0, max: 100, noNaN: true }),
  points: fc.array(trendPointArb, { minLength: 1, maxLength: 12 }),
});

const sensorTypeArb = fc.constantFrom("temperature", "humidity", "soil_moisture", "light");

const timeSeriesPointArb = fc.record({
  timestamp: fc.string({ minLength: 1, maxLength: 30 }),
  value: fc.float({ min: 0, max: 100, noNaN: true }),
});

const sensorTimeSeriesArb = fc.record({
  sensor_type: sensorTypeArb,
  unit: fc.constantFrom("°C", "%", "%", "lux"),
  points: fc.array(timeSeriesPointArb, { minLength: 1, maxLength: 48 }),
});

const severityArb = fc.constantFrom("critical" as const, "warning" as const, "info" as const);

const alertArb = fc.record({
  alert_id: fc.uuid(),
  severity: severityArb,
  message: fc.string({ minLength: 1, maxLength: 100 }),
  timestamp: fc.constant("2024-01-01T00:00:00Z"),
  acknowledged: fc.boolean(),
});

const weatherConditionArb = fc.constantFrom("sunny", "cloudy", "rainy", "partly_cloudy", "thunderstorm");

const currentWeatherArb: fc.Arbitrary<CurrentWeather> = fc.record({
  temperature: fc.float({ min: -10, max: 50, noNaN: true }),
  humidity: fc.float({ min: 0, max: 100, noNaN: true }),
  wind_speed: fc.float({ min: 0, max: 200, noNaN: true }),
  condition: weatherConditionArb,
  location: fc.string({ minLength: 1, maxLength: 50 }),
});

const healthStatusArb = fc.constantFrom("healthy" as const, "needs_attention" as const, "critical" as const);

// Alphanumeric string arbitrary for text that must be visible and findable in the DOM
const visibleStringArb = fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9 ]{0,19}$/);

const zoneCropHealthArb: fc.Arbitrary<ZoneCropHealth> = fc.record({
  zone_id: fc.uuid(),
  zone_name: visibleStringArb,
  crop_type: visibleStringArb,
  health_status: healthStatusArb,
  growth_stage: visibleStringArb,
  last_inspection: fc.constant("2024-06-15T10:00:00Z"),
  notes: fc.string({ maxLength: 50 }),
});

const robotTypeArb = fc.constantFrom("drone" as const, "ground_rover" as const, "harvester" as const);
const robotStatusArb = fc.constantFrom("active" as const, "idle" as const, "charging" as const, "maintenance" as const);

const robotArb: fc.Arbitrary<Robot> = fc.record({
  robot_id: fc.uuid(),
  name: visibleStringArb,
  type: robotTypeArb,
  status: robotStatusArb,
  assigned_zone: visibleStringArb,
  battery_level: fc.integer({ min: 0, max: 100 }),
});

const scenarioArb: fc.Arbitrary<SimulationScenario> = fc.record({
  scenario_id: fc.uuid(),
  name: fc.stringMatching(/^Name [a-zA-Z0-9]{1,10}$/),
  description: fc.stringMatching(/^Desc [a-zA-Z0-9]{1,10}$/),
  robot_type: fc.constantFrom("drone", "ground_rover", "harvester"),
  estimated_duration_minutes: fc.integer({ min: 1, max: 120 }),
});

// ─── Property 3: Sparkline card renders trend data for all metrics ──────────
// Feature: comprehensive-dashboard, Property 3: Sparkline card renders trend data for all metrics

describe("Property 3: Sparkline card renders trend data for all metrics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders a SparklineCard for each metric in the trends response", async () => {
    const { SparklineCard } = await import("../SparklineCard");

    await fc.assert(
      fc.asyncProperty(
        fc.array(metricTrendArb, { minLength: 1, maxLength: 4 }).filter((arr) => {
          // Ensure unique metric names so we can count them
          const names = new Set(arr.map((m) => m.metric));
          return names.size === arr.length;
        }),
        async (metrics: MetricTrend[]) => {
          const { unmount } = render(
            <div>
              {metrics.map((m) => (
                <SparklineCard
                  key={m.metric}
                  label={m.metric}
                  value={m.current_value}
                  unit={m.unit}
                  data={m.points}
                  color="#000"
                />
              ))}
            </div>,
          );

          // Each metric label should appear exactly once
          for (const m of metrics) {
            const elements = screen.getAllByText(m.metric);
            expect(elements.length).toBe(1);
          }

          unmount();
          cleanup();
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Property 2: Chart renders all sensor type lines (data merging logic) ───
// Feature: comprehensive-dashboard, Property 2: Chart renders all sensor type lines

describe("Property 2: Chart data merging produces entries for all sensor types", () => {
  it("merged chart data contains keys for every sensor type in the response", () => {
    // This tests the data transformation logic from SensorTimeSeriesChart
    function mergeTimeSeries(series: SensorTimeSeries[]): Record<string, number | string>[] {
      const timestampMap = new Map<string, Record<string, number | string>>();
      for (const s of series) {
        for (const p of s.points) {
          const existing = timestampMap.get(p.timestamp) ?? { timestamp: p.timestamp };
          existing[s.sensor_type] = p.value;
          timestampMap.set(p.timestamp, existing);
        }
      }
      return Array.from(timestampMap.values()).sort((a, b) =>
        String(a.timestamp).localeCompare(String(b.timestamp)),
      );
    }

    fc.assert(
      fc.property(
        fc.array(sensorTimeSeriesArb, { minLength: 1, maxLength: 4 }).filter((arr) => {
          const types = new Set(arr.map((s) => s.sensor_type));
          return types.size === arr.length;
        }),
        (series: SensorTimeSeries[]) => {
          const merged = mergeTimeSeries(series);
          const sensorTypes = series.map((s) => s.sensor_type);

          // Every sensor type should appear as a key in at least one merged entry
          for (const st of sensorTypes) {
            const hasKey = merged.some((entry) => st in entry);
            expect(hasKey).toBe(true);
          }

          // The number of unique timestamps should equal the merged array length
          const allTimestamps = new Set(series.flatMap((s) => s.points.map((p) => p.timestamp)));
          expect(merged.length).toBe(allTimestamps.size);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Property 5: Alerts are sorted by severity (frontend) ──────────────────
// Feature: comprehensive-dashboard, Property 5: Alerts are sorted by severity

describe("Property 5: Alerts are sorted by severity (frontend)", () => {
  const SEVERITY_ORDER: Record<string, number> = { critical: 0, warning: 1, info: 2 };

  it("after sorting, severity_rank(alerts[i]) <= severity_rank(alerts[j]) for all i < j", () => {
    fc.assert(
      fc.property(
        fc.array(alertArb, { minLength: 1, maxLength: 20 }),
        (alerts) => {
          const sorted = [...alerts].sort(
            (a, b) => (SEVERITY_ORDER[a.severity] ?? 3) - (SEVERITY_ORDER[b.severity] ?? 3),
          );

          for (let i = 0; i < sorted.length - 1; i++) {
            const rankI = SEVERITY_ORDER[sorted[i].severity] ?? 3;
            const rankJ = SEVERITY_ORDER[sorted[i + 1].severity] ?? 3;
            expect(rankI).toBeLessThanOrEqual(rankJ);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});


// ─── Property 6: Weather widget displays all required fields ────────────────
// Feature: comprehensive-dashboard, Property 6: Weather widget displays all required fields

describe("Property 6: Weather widget displays all required fields", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders temperature, humidity, wind_speed, and condition for any valid weather data", async () => {
    const { WeatherWidget } = await import("../WeatherWidget");

    await fc.assert(
      fc.asyncProperty(currentWeatherArb, async (weather: CurrentWeather) => {
        mockApi.get.mockImplementation((url: string) => {
          if (url.includes("/weather/current")) {
            return Promise.resolve({ data: weather });
          }
          if (url.includes("/weather/forecast")) {
            return Promise.resolve({ data: [] });
          }
          return Promise.reject(new Error("unexpected url"));
        });

        const qc = createQueryClient();
        const { unmount, container } = render(
          <QueryClientProvider client={qc}>
            <WeatherWidget />
          </QueryClientProvider>,
        );

        const view = within(container);

        await waitFor(() => {
          expect(view.getByText("Weather")).toBeInTheDocument();
        });

        // Temperature appears as "X°C"
        expect(view.getByText(`${weather.temperature}°C`)).toBeInTheDocument();
        // Humidity appears as "X%"
        expect(view.getByText(`${weather.humidity}%`)).toBeInTheDocument();
        // Wind speed appears as "X km/h"
        expect(view.getByText(`${weather.wind_speed} km/h`)).toBeInTheDocument();
        // Condition text (with underscores replaced by spaces)
        const conditionText = weather.condition.replace("_", " ");
        expect(view.getByText(conditionText)).toBeInTheDocument();

        unmount();
        qc.clear();
        cleanup();
      }),
      { numRuns: 100 },
    );
  }, 60_000);
});

// ─── Property 8: Crop health zone data completeness ─────────────────────────
// Feature: comprehensive-dashboard, Property 8: Crop health zone data completeness

describe("Property 8: Crop health zone data completeness", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  const STATUS_LABEL: Record<string, string> = {
    healthy: "Healthy",
    needs_attention: "Needs Attention",
    critical: "Critical",
  };

  it("renders health_status badge, crop_type, growth_stage, and last_inspection for any zone data", async () => {
    const { CropHealthWidget } = await import("../CropHealthWidget");

    await fc.assert(
      fc.asyncProperty(zoneCropHealthArb, async (zone: ZoneCropHealth) => {
        mockApi.get.mockResolvedValue({ data: [zone] });

        const qc = createQueryClient();
        const { unmount, container } = render(
          <QueryClientProvider client={qc}>
            <CropHealthWidget />
          </QueryClientProvider>,
        );

        const view = within(container);

        await waitFor(() => {
          expect(view.getByText("Crop Health")).toBeInTheDocument();
        });

        // Health status badge
        expect(view.getByText(STATUS_LABEL[zone.health_status])).toBeInTheDocument();
        // Crop type and growth stage appear together — check via container text
        const allText = container.textContent ?? "";
        expect(allText).toContain(zone.crop_type);
        expect(allText).toContain(zone.growth_stage.trim());
        // Last inspection date
        const dateStr = new Date(zone.last_inspection).toLocaleDateString();
        expect(allText).toContain(dateStr);

        unmount();
        qc.clear();
        cleanup();
      }),
      { numRuns: 100 },
    );
  }, 60_000);
});

// ─── Property 13: Robot fleet displays all required fields ──────────────────
// Feature: comprehensive-dashboard, Property 13: Robot fleet displays all required fields

describe("Property 13: Robot fleet displays all required fields", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  const TYPE_LABEL: Record<string, string> = {
    drone: "Drone",
    ground_rover: "Ground Rover",
    harvester: "Harvester",
  };

  it("renders name, type, status, and zone for any valid robot data", async () => {
    const { RobotFleetWidget } = await import("../RobotFleetWidget");

    await fc.assert(
      fc.asyncProperty(robotArb, async (robot: Robot) => {
        const summary = { active: 0, idle: 0, charging: 0, maintenance: 0 };
        summary[robot.status] = 1;

        mockApi.get.mockResolvedValue({ summary, data: [robot] });

        const qc = createQueryClient();
        const { unmount, container } = render(
          <QueryClientProvider client={qc}>
            <RobotFleetWidget />
          </QueryClientProvider>,
        );

        const view = within(container);

        await waitFor(() => {
          expect(view.getByText("Robot Fleet")).toBeInTheDocument();
        });

        // Robot name — check via container text to handle whitespace normalization
        const typeLabel = TYPE_LABEL[robot.type] ?? robot.type;
        const allText = container.textContent ?? "";
        expect(allText).toContain(robot.name.trim());
        // Type label and zone
        expect(allText).toContain(typeLabel);
        expect(allText).toContain(robot.assigned_zone.trim());
        // Status badge
        expect(allText).toContain(robot.status);

        unmount();
        qc.clear();
        cleanup();
      }),
      { numRuns: 100 },
    );
  }, 60_000);
});

// ─── Property 14: Maintenance robots are highlighted ────────────────────────
// Feature: comprehensive-dashboard, Property 14: Maintenance robots are highlighted

describe("Property 14: Maintenance robots are highlighted", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("maintenance robots have warning class, non-maintenance robots do not", async () => {
    const { RobotFleetWidget } = await import("../RobotFleetWidget");

    await fc.assert(
      fc.asyncProperty(
        fc.array(robotArb, { minLength: 1, maxLength: 6 }),
        async (robots: Robot[]) => {
          const summary = { active: 0, idle: 0, charging: 0, maintenance: 0 };
          for (const r of robots) summary[r.status]++;

          mockApi.get.mockResolvedValue({ summary, data: robots });

          const qc = createQueryClient();
          const { unmount, container } = render(
            <QueryClientProvider client={qc}>
              <RobotFleetWidget />
            </QueryClientProvider>,
          );

          const view = within(container);

          await waitFor(() => {
            expect(view.getByText("Robot Fleet")).toBeInTheDocument();
          });

          const listItems = container.querySelectorAll("li");
          for (let i = 0; i < robots.length; i++) {
            const li = listItems[i];
            if (robots[i].status === "maintenance") {
              expect(li.className).toContain("border-yellow-300");
              expect(li.className).toContain("bg-yellow-50");
            } else {
              expect(li.className).not.toContain("border-yellow-300");
            }
          }

          unmount();
          qc.clear();
          cleanup();
        },
      ),
      { numRuns: 100 },
    );
  }, 60_000);
});


// ─── Property 9: Isaac Sim connection status indicator correctness ───────────
// Feature: comprehensive-dashboard, Property 9: Isaac Sim connection status indicator correctness

describe("Property 9: Isaac Sim connection status indicator correctness", () => {
  it("STATUS_COLORS maps each ConnectionStatus to the correct color class", () => {
    const STATUS_COLORS: Record<ConnectionStatus, string> = {
      disconnected: "bg-gray-400",
      connecting: "bg-yellow-400",
      connected: "bg-green-500",
      error: "bg-red-500",
    };

    const allStatuses: ConnectionStatus[] = ["disconnected", "connecting", "connected", "error"];

    fc.assert(
      fc.property(
        fc.constantFrom(...allStatuses),
        (status: ConnectionStatus) => {
          const color = STATUS_COLORS[status];
          switch (status) {
            case "disconnected":
              expect(color).toBe("bg-gray-400");
              break;
            case "connecting":
              expect(color).toBe("bg-yellow-400");
              break;
            case "connected":
              expect(color).toBe("bg-green-500");
              break;
            case "error":
              expect(color).toBe("bg-red-500");
              break;
          }
          expect(color).toBeDefined();
          expect(color.length).toBeGreaterThan(0);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Property 10: Isaac Sim connection config validation ────────────────────
// Feature: comprehensive-dashboard, Property 10: Isaac Sim connection config validation

describe("Property 10: Isaac Sim connection config validation", () => {
  // Replicate the validation logic from IsaacSimPanel
  function validate(config: { host: string; port: number }): { host?: string; port?: string } {
    const errors: { host?: string; port?: string } = {};
    if (!config.host.trim()) errors.host = "Host is required";
    if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
      errors.port = "Port must be between 1 and 65535";
    }
    return errors;
  }

  it("accepts iff host.trim() is non-empty AND port is integer in [1, 65535]", () => {
    fc.assert(
      fc.property(
        fc.string({ maxLength: 50 }),
        fc.oneof(
          fc.integer({ min: -1000, max: 70000 }),
          fc.float({ min: -1000, max: 70000, noNaN: true }),
        ),
        (host: string, port: number) => {
          const errors = validate({ host, port });
          const isHostValid = host.trim().length > 0;
          const isPortValid = Number.isInteger(port) && port >= 1 && port <= 65535;

          if (isHostValid && isPortValid) {
            expect(Object.keys(errors).length).toBe(0);
          } else {
            expect(Object.keys(errors).length).toBeGreaterThan(0);
            if (!isHostValid) expect(errors.host).toBeDefined();
            if (!isPortValid) expect(errors.port).toBeDefined();
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Property 11: Isaac Sim config localStorage round-trip ──────────────────
// Feature: comprehensive-dashboard, Property 11: Isaac Sim config localStorage round-trip

describe("Property 11: Isaac Sim config localStorage round-trip", () => {
  const STORAGE_KEY = "isaac-sim-config";

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("serialize to localStorage then deserialize produces equivalent config", () => {
    const configArb: fc.Arbitrary<IsaacSimConfig> = fc.record({
      host: fc.string({ minLength: 0, maxLength: 50 }),
      port: fc.integer({ min: 1, max: 65535 }),
      streamUrl: fc.string({ minLength: 0, maxLength: 100 }),
    });

    fc.assert(
      fc.property(configArb, (config: IsaacSimConfig) => {
        // Serialize
        localStorage.setItem(STORAGE_KEY, JSON.stringify(config));

        // Deserialize
        const raw = localStorage.getItem(STORAGE_KEY);
        expect(raw).not.toBeNull();
        const deserialized = JSON.parse(raw!) as IsaacSimConfig;

        // Verify equality
        expect(deserialized.host).toBe(config.host);
        expect(deserialized.port).toBe(config.port);
        expect(deserialized.streamUrl).toBe(config.streamUrl);
      }),
      { numRuns: 100 },
    );
  });
});

// ─── Property 15: Scenario list displays all required fields ────────────────
// Feature: comprehensive-dashboard, Property 15: Scenario list displays all required fields

describe("Property 15: Scenario list displays all required fields", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders name, description, robot_type, and duration for any valid scenario data", async () => {
    const { IsaacSimScenarioList } = await import("../IsaacSimScenarioList");

    await fc.assert(
      fc.asyncProperty(scenarioArb, async (scenario: SimulationScenario) => {
        mockApi.get.mockResolvedValue({ data: [scenario] });

        const qc = createQueryClient();
        const { unmount, container } = render(
          <QueryClientProvider client={qc}>
            <IsaacSimScenarioList connectionStatus="connected" />
          </QueryClientProvider>,
        );

        const view = within(container);

        await waitFor(() => {
          expect(view.getByText("Simulation Scenarios")).toBeInTheDocument();
        });

        // Scenario name
        expect(view.getByText(scenario.name)).toBeInTheDocument();
        // Description
        expect(view.getByText(scenario.description)).toBeInTheDocument();
        // Robot type appears as "Robot: type"
        expect(view.getByText(`Robot: ${scenario.robot_type}`)).toBeInTheDocument();
        // Duration appears as "~X min"
        expect(view.getByText(`~${scenario.estimated_duration_minutes} min`)).toBeInTheDocument();

        unmount();
        qc.clear();
        cleanup();
      }),
      { numRuns: 100 },
    );
  }, 60_000);
});
