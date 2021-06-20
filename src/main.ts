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
        <input name="device" autofocus value="${params.device || ""}">
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
    e.preventDefault()
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
  <pre class="js-errors"></pre>
`

  const $noiseLevel = document.querySelector(".js-noise-level")!
  const $errors = document.querySelector(".js-errors")!

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
    logSent?: boolean
  }

  const periodSeconds = 3
  const keepPeriods = 60

  function sum(nums: number[]) {
    return nums.reduce((acc, x) => acc + x, 0)
  }

  function avg(nums: number[]) {
    return sum(nums) / nums.length
  }

  function quantiles(thresholds: number[], sortedNums: number[]) {
    return thresholds.map((threshold) => {
      const result = sortedNums[Math.round((sortedNums.length - 1) * threshold)]
      if (result === undefined) {
        console.error({ result, sortedNums, threshold })
      }
      return result
    })
  }

  function last<T>(arr: T[]): T {
    return arr[arr.length - 1]
  }

  function createStore() {
    let measurementsByPeriods: MeasurementsByPeriod[] = []

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

        if (measurementsByPeriods.length > 0) {
          last(measurementsByPeriods).measurements.sort()
        }

        measurementsByPeriods.push(currentPeriodMeasurements)
        measurementsByPeriods = measurementsByPeriods.slice(-10)
      }

      currentPeriodMeasurements.measurements.push(measurement)
    }

    function getMetrics(measurements: number[]) {
      const [q50, q75, q90, q95, q99, q100] = quantiles(
        [0.5, 0.75, 0.9, 0.95, 0.99, 1],
        measurements
      )
      return { q50, q75, q90, q95, q99, max: q100, avg: avg(measurements) }
    }

    function getLastPeriodsMeasurements() {
      return measurementsByPeriods.slice(-1 - keepPeriods, -1).map((group) => {
        return getMetrics(group.measurements)
      })
    }

    function getLogLines() {
      const groups = measurementsByPeriods.filter((group) => !group.logSent)

      groups.forEach((group) => {
        group.logSent = true
      })

      return groups.map((group) => {
        return [
          String(group.time * 1_000_000),
          JSON.stringify(getMetrics(group.measurements)),
        ]
      })
    }

    return {
      addMeasurement,
      getLastPeriodsMeasurements,
      getPeriodID,
      getLogLines,
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

  function transparent(color: string) {
    return color.replace(")", ", 0.2)")
  }

  const colors = {
    blue: "rgb(54, 162, 235)",
    orange: "rgb(255, 159, 64)",
    red: "rgb(255, 99, 132)",
    purple: "rgb(153, 102, 255)",
    seagreen: "rgb(75, 192, 192)",
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
          label: "75% were louder then",
          data: data.map((x) => x.q75),
          borderColor: colors.seagreen,
          backgroundColor: transparent(colors.blue),
          borderWidth: 1,
        },
        {
          label: "95% were lounder then",
          data: data.map((x) => x.q95),
          borderColor: colors.blue,
          backgroundColor: transparent(colors.seagreen),
          borderWidth: 1,
        },
        {
          label: "99% were lounder then",
          data: data.map((x) => x.q99),
          borderColor: colors.purple,
          backgroundColor: transparent(colors.purple),
          borderWidth: 1,
        },
        {
          label: "100% were lounder then",
          data: data.map((x) => x.max),
          borderColor: colors.red,
          backgroundColor: transparent(colors.red),
          borderWidth: 1,
          borderDash: [10],
        },
      ],
    }
  }

  function createChart(chartData: ChartData) {
    return new Chart(document.getElementById("chart") as HTMLCanvasElement, {
      type: "line",
      data: chartData,
      options: {
        animation: {
          duration: 0,
        },
        scales: {
          y: {
            beginAtZero: true,
            suggestedMax: 0.5,
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
      const log = {
        streams: [
          {
            stream: {
              job: "noise_level",
              device: params.device,
            },
            values: store.getLogLines(),
          },
        ],
      }

      const res = await fetch("/api/save-log", {
        method: "POST",
        headers: {
          Authorization: `Basic ${btoa(params.lokiBasicAuth)}`,
        },
        body: JSON.stringify(log),
      })

      if (res.status >= 300) {
        throw new Error("Bad response status code (see server logs)")
      }
    } catch (err) {
      console.error(err)
      $errors.textContent += err.toString() + "\n"
    }
  }
}
