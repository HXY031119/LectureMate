/// <reference types="vite/client" />
import type { LectureMateApi } from "../shared/contracts";
declare global { interface Window { lectureMate: LectureMateApi } }
export {};

