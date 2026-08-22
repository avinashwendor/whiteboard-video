import { defineRailway, project, service } from "railway/iac";

export default defineRailway(() => {
  const web = service("video-whiteboard-generator", {
    build: "npm run build",
    start: "npm run start",
    healthcheck: "/api/capabilities",
    healthcheckTimeout: 30,
    // builder from CaC: "NIXPACKS"
  });

  return project("video-whiteboard-generator", {
    resources: [web],
  });
});
