import { Chart, registerables } from "chart.js";
import "./style.css";

Chart.register(...registerables);

const app = document.querySelector<HTMLDivElement>("#app")!;

const noiseLevel = 0;

app.innerHTML = `
  <h1>
    Noise level: <span class="js-noise-level">${
      noiseLevel || "measuring…"
    }</span>
  </h1>
  <div class="chart-container">
    <canvas id="chart"></canvas>
  </div>
`;

const $noiseLevel = document.querySelector(".js-noise-level")!;

const stream = await navigator.mediaDevices.getUserMedia({
  audio: true,
  video: false,
});
const audioContext = new AudioContext();
const mediaStreamAudioSourceNode = audioContext.createMediaStreamSource(stream);
const analyserNode = audioContext.createAnalyser();
mediaStreamAudioSourceNode.connect(analyserNode);

function getNoiseLevel() {
  const pcmData = new Float32Array(analyserNode.fftSize);
  analyserNode.getFloatTimeDomainData(pcmData);
  let sumSquares = 0.0;
  for (const amplitude of pcmData) {
    sumSquares += amplitude * amplitude;
  }
  return Math.sqrt(sumSquares / pcmData.length);
}

interface MeasurementsByPeriod {
  periodID: number;
  measurements: number[];
}

const periodSeconds = 3;

function avg(nums: number[]) {
  return nums.reduce((acc, x) => acc + x, 0) / nums.length;
}

function last<T>(arr: T[]): T {
  return arr[arr.length - 1];
}

function createStore() {
  const measurementsByPeriods: MeasurementsByPeriod[] = [];

  function getPeriodID(now: number) {
    return Math.floor(now / 1000 / periodSeconds);
  }

  function addMeasurement(measurement: number, now: number) {
    const periodID = getPeriodID(now);
    let currentPeriodMeasurements = last(measurementsByPeriods);

    if (
      !currentPeriodMeasurements ||
      currentPeriodMeasurements.periodID !== periodID
    ) {
      currentPeriodMeasurements = { periodID, measurements: [] };
      measurementsByPeriods.push(currentPeriodMeasurements);
    }

    currentPeriodMeasurements.measurements.push(measurement);
  }

  function getLastPeriodsMeasurements() {
    return measurementsByPeriods.slice(-61, -1).map(({ measurements }) => {
      return avg(measurements);
    });
  }

  return { addMeasurement, getLastPeriodsMeasurements, getPeriodID };
}

const store = createStore();
let lastDisplayedPeriod: number | null = null;

const onFrame = () => {
  const now = Date.now();
  const periodID = store.getPeriodID(now);
  store.addMeasurement(getNoiseLevel(), now);

  if (periodID !== lastDisplayedPeriod) {
    lastDisplayedPeriod = periodID;
    updateInterface();
  }

  window.requestAnimationFrame(onFrame);
};

window.requestAnimationFrame(onFrame);

type Color = "blue" | "orange" | "red";

const bgColors = {
  blue: "rgba(54, 162, 235, 0.2)",
  orange: "rgba(255, 159, 64, 0.2)",
  red: "rgba(255, 99, 132, 0.2)",
} as const;

const borderColors = {
  blue: "rgb(54, 162, 235)",
  orange: "rgb(255, 159, 64)",
  red: "rgb(255, 99, 132)",
} as const;

function getColor(measurementsAvg: number): Color {
  if (measurementsAvg > 0.4) {
    return "red";
  }

  if (measurementsAvg > 0.2) {
    return "orange";
  }

  return "blue";
}

function getChartData() {
  const data = store.getLastPeriodsMeasurements();

  const labels = data.map((_, i) => {
    return `${(data.length - i) * periodSeconds}s ago`;
  });

  return {
    labels,
    datasets: [
      {
        label: "Noise level",
        data,
        backgroundColor: data.map((y) => bgColors[getColor(y)]),
        borderColor: data.map((y) => borderColors[getColor(y)]),
        borderWidth: 1,
      },
    ],
  };
}

declare const Chart: any;

function createChart(chartData: any) {
  return new Chart(document.getElementById("chart"), {
    type: "bar",
    data: chartData,
    options: {
      animation: {
        duration: 0,
      },
      scales: {
        y: {
          beginAtZero: true,
          suggestedMax: 1,
        },
      },
    },
  });
}

let chart: any = null;
function updateInterface() {
  const updatedData = getChartData();
  const data = updatedData.datasets[0].data;
  if (data.length === 0) {
    return;
  }

  $noiseLevel.textContent = String(Math.round(last(data) * 100000) / 100000);

  if (!chart) {
    chart = createChart(updatedData);
    return;
  }

  chart.config.data = updatedData;
  chart.update();
}
