/// <reference types="vite/client" />
import { createRoot } from "react-dom/client";
import { NassiEditor } from "../app/NassiEditor";
import "../app/globals.css";

createRoot(document.getElementById("root")!).render(
  <NassiEditor assetBasePath={import.meta.env.BASE_URL.replace(/\/$/, "")} />,
);
