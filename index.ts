import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import axios from "axios";
import { ScreepsAPI } from "screeps-api";

const agentConfig = new pulumi.Config("agent");
const screepsConfig = new pulumi.Config("screeps");
const grafanaConfig = new pulumi.Config("grafana");

const shard = screepsConfig.get("shard");
const host = screepsConfig.get("host") ?? "screeps.com";
const memoryPath = screepsConfig.require("memoryPath");
const apiPath = screepsConfig.get("apiPath") ?? "/";
const screepsToken = screepsConfig.requireSecret("token");

const prefix = grafanaConfig.get("prefix");

const schedule = agentConfig.require("schedule", {
  pattern: /^(rate)|(cron)\(.*\)$/,
});

const grafanaHost =
  grafanaConfig.get("host") ?? "https://screepspl.us/api/stats/submit";
const grafanaUsername = grafanaConfig.get("username");
const grafanaToken = grafanaConfig.requireSecret("token");

const collectStatsSchedule = aws.cloudwatch.onSchedule(
  "screeps-collect-stats",
  schedule,
  async () => {
    const api = new ScreepsAPI({
      token: screepsToken.get(),
      secure: true,
      host: host,
      port: 443,
      path: apiPath,
    });

    const rawMemory = await api.userMemoryGet(memoryPath, shard);
    const statsMemory = JSON.parse(rawMemory);
    const body = prefix
      ? {
          [prefix]: statsMemory,
        }
      : statsMemory;

    await axios.post(grafanaHost, body, {
      headers: {
        "Content-Type": "application/json",
      },
      auth: {
        username: grafanaUsername ?? "token",
        password: grafanaToken.get(),
      },
    });
  }
);
