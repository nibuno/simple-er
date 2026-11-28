import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "./style.css";
import "../shared/diagrams.css";
import "../shared/file-dialogs.css";
createRoot(document.getElementById("root")!).render(<App />);
