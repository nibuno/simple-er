import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./style.css";
import "../../shared/diagrams.css";
import "./variants.css";
createRoot(document.getElementById("root")!).render(<App />);
