import { Chart, ChartData, registerables } from "chart.js"
import "./style.css"

Chart.register(...registerables)

const app = document.querySelector<HTMLDivElement>("#app")!

main()

interface StartFormParams {
  device: string
  lokiBasicAuth: string
}

function getStartFormParams() {
  try {
    return JSON.parse(localStorage.getItem("start-form-params") || "") || {}
  } catch {
    return {}
  }
}

function main() {
  const params = getStartFormParams()

  app.innerHTML = `
    <h1 class="heading">
      Fill form to start measurements
    </h1>
    <form class="js-start-form start-form">
      <label>
        <span class="label">
          Device name:
        </span>
        <input name="device" value="${params.device || ""}">
      </label>
      <br>

      <label>
        <span class="label">
          Loki basic auth:
        </span>
        <input type="password" name="lokiBasicAuth" value="${
          params.lokiBasicAuth || ""
        }">
      </label>
      <br>

      <button type="submit">Start</button>
    </form>
  `

  const form = document.querySelector(".js-start-form")!

  form.addEventListener("submit", (e) => {
    const params: StartFormParams = Object.fromEntries(
      (new FormData(e.target as any) as any).entries()
    ) as any
    localStorage.setItem("start-form-params", JSON.stringify(params))
    initExporter(params)
  })
}

async function initExporter(params: StartFormParams) {
  const noiseLevel = 0

  app.innerHTML = `
  <h1 class="heading">
    Noise level: <span class="js-noise-level">${
      noiseLevel || "measuring…"
    }</span>
  </h1>
  <div class="chart-container">
    <canvas id="chart"></canvas>
  </div>
`

  const $noiseLevel = document.querySelector(".js-noise-level")!

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: true,
    video: false,
  })
  const audioContext = new AudioContext()
  const mediaStreamAudioSourceNode =
    audioContext.createMediaStreamSource(stream)
  const analyserNode = audioContext.createAnalyser()
  mediaStreamAudioSourceNode.connect(analyserNode)

  function getNoiseLevel() {
    const pcmData = new Float32Array(analyserNode.fftSize)
    analyserNode.getFloatTimeDomainData(pcmData)
    let sumSquares = 0.0
    for (const amplitude of pcmData) {
      sumSquares += amplitude * amplitude
    }
    return Math.sqrt(sumSquares / pcmData.length)
  }

  interface MeasurementsByPeriod {
    periodID: number
    time: number
    measurements: number[]
  }

  const periodSeconds = 3
  const keepPeriods = 60

  function sum(nums: number[]) {
    return nums.reduce((acc, x) => acc + x, 0)
  }

  function avg(nums: number[]) {
    return sum(nums) / nums.length
  }

  function last<T>(arr: T[]): T {
    return arr[arr.length - 1]
  }

  function createStore() {
    let measurementsByPeriods: MeasurementsByPeriod[] = []
    let noiseLevelTotalForRemovedMeasurements = 0

    function getPeriodID(now: number) {
      return Math.floor(now / 1000 / periodSeconds)
    }

    function addMeasurement(measurement: number, now: number) {
      const periodID = getPeriodID(now)
      let currentPeriodMeasurements = last(measurementsByPeriods)

      if (
        !currentPeriodMeasurements ||
        currentPeriodMeasurements.periodID !== periodID
      ) {
        currentPeriodMeasurements = { periodID, time: now, measurements: [] }
        measurementsByPeriods.push(currentPeriodMeasurements)
      }

      currentPeriodMeasurements.measurements.push(measurement)

      noiseLevelTotalForRemovedMeasurements += sum(
        measurementsByPeriods
          .slice(0, -keepPeriods)
          .map((group) => avg(group.measurements))
      )
      measurementsByPeriods = measurementsByPeriods.slice(-10)
    }

    function getLastPeriodsMeasurements() {
      return measurementsByPeriods
        .slice(-1 - keepPeriods, -1)
        .map((group) => avg(group.measurements))
    }

    function getNoiseLevelTotal() {
      return (
        noiseLevelTotalForRemovedMeasurements +
        sum(measurementsByPeriods.map((group) => avg(group.measurements)))
      )
    }

    function getLogLine() {
      const group = last(measurementsByPeriods)
      if (!group) {
        return undefined
      }

      return [
        String(group.time * 1_000_000),
        JSON.stringify({ avg: avg(group.measurements) }),
      ]
    }

    return {
      addMeasurement,
      getLastPeriodsMeasurements,
      getPeriodID,
      getNoiseLevelTotal,
      getLogLine,
    }
  }

  const store = createStore()
  let lastDisplayedPeriod: number | null = null

  const onFrame = () => {
    const now = Date.now()
    const periodID = store.getPeriodID(now)
    store.addMeasurement(getNoiseLevel(), now)

    if (periodID !== lastDisplayedPeriod) {
      lastDisplayedPeriod = periodID
      updateInterface()
    }

    window.requestAnimationFrame(onFrame)
  }

  window.requestAnimationFrame(onFrame)

  type Color = "blue" | "orange" | "red"

  const bgColors = {
    blue: "rgba(54, 162, 235, 0.2)",
    orange: "rgba(255, 159, 64, 0.2)",
    red: "rgba(255, 99, 132, 0.2)",
  } as const

  const borderColors = {
    blue: "rgb(54, 162, 235)",
    orange: "rgb(255, 159, 64)",
    red: "rgb(255, 99, 132)",
  } as const

  function getColor(measurementsAvg: number): Color {
    if (measurementsAvg > 0.4) {
      return "red"
    }

    if (measurementsAvg > 0.2) {
      return "orange"
    }

    return "blue"
  }

  function getChartData() {
    const data = store.getLastPeriodsMeasurements()

    const labels = data.map((_, i) => {
      return `${(data.length - i) * periodSeconds}s ago`
    })

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
    }
  }

  function createChart(chartData: ChartData) {
    return new Chart(document.getElementById("chart") as HTMLCanvasElement, {
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
    })
  }

  let chart: any = null
  function updateInterface() {
    const updatedData = getChartData()
    const data = updatedData.datasets[0].data
    if (data.length === 0) {
      return
    }

    sendMetrics()

    $noiseLevel.textContent = String(Math.round(last(data) * 100000) / 100000)

    if (!chart) {
      chart = createChart(updatedData)
      return
    }

    chart.config.data = updatedData
    chart.update()
  }

  async function sendMetrics() {
    try {
      const pushgatewayURL =
        "https://thingproxy.freeboard.io/fetch/https://logs-prod-us-central1.grafana.net/loki/api/v1/push"

      const log = {
        streams: [
          {
            stream: {
              job: "noise_level",
              device: params.device,
            },
            values: [store.getLogLine()],
          },
        ],
      }

      const res = await fetch(pushgatewayURL, {
        method: "POST",
        mode: "cors",
        referrerPolicy: "no-referrer",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Basic ${btoa(params.lokiBasicAuth)}`,
        },
        body: JSON.stringify(log),
      })

      if (res.status >= 300) {
        throw new Error(await res.text())
      }
    } catch (err) {
      console.error(err)
    }
  }
}
