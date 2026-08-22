import { defineRailway, github, preserve, project, service } from "railway/iac";

export default defineRailway(() => {
  const whiteboardVideo = service("whiteboard-video", {
    source: github("avinashwendor/whiteboard-video", { checkSuites: false }),
    build: { builder: "NIXPACKS", buildCommand: "npm run build" },
    start: "npm run start",
    healthcheck: "/api/capabilities",
    healthcheckTimeout: 30,
    replicas: { "sfo": 1 },
    deploy: { restartPolicyMaxRetries: 5 },
    env: {
      CARTESIA_API_KEY: preserve(),
      DEEPGRAM_API_KEY: preserve(),
      OMEGA_API_KEY: preserve(),
      TAVILY_API_KEY: preserve(),
    },
  });

  return project("whiteboard-video", {
    resources: [whiteboardVideo],
  });
});
