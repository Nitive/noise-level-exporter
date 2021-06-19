import { VercelRequest, VercelResponse } from "@vercel/node"
import fetch from "node-fetch"

const lokiURL = "https://logs-prod-us-central1.grafana.net/loki/api/v1/push"

export default async (req: VercelRequest, res: VercelResponse) => {
  console.log(`Processing ${req.method} /api/save-log`)
  try {
    if (req.method !== "POST") {
      res.status(400).send("Only POST requests are allowed")
      console.log("Response 400: Only POST requests are allowed")
      return
    }

    const lokiRes = await fetch(lokiURL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: req.headers.authorization,
      },
      body: req.body,
    })

    if (lokiRes.status >= 300) {
      console.error(await lokiRes.text())
    }

    res.status(lokiRes.status).send("")
  } catch (err) {
    console.error(err)
    res.status(500).send("Internal error")
  }
}
