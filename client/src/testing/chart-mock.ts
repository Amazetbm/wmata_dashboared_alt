/** usage in spec: vi.mock('chart.js/auto', () => chartMock) */
export const chartMock = {
  default: class MockChart {
    static register = vi.fn();
    data: { labels: any[]; datasets: { data: any[] }[] } = { labels: [], datasets: [{ data: [] }, { data: [] }, { data: [] }] };
    update = vi.fn();
    destroy = vi.fn();
    constructor(_ctx: any, _config: any) {}
  }
};

/** usage in spec: vi.mock('chart.js', () => chartJsMock) */
export const chartJsMock = {
  Chart: class MockChart {
    static register = vi.fn();
    data: { labels: any[]; datasets: { data: any[] }[] } = { labels: [], datasets: [{ data: [] }, { data: [] }, { data: [] }] };
    update = vi.fn();
    destroy = vi.fn();
    constructor(_ctx: any, _config: any) {}
  },
  registerables: [],
};
