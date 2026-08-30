import { Aria2 } from "@aria2";
import { Sophon } from "@sophon";
import { Locale } from "@locale";
import { Wine } from "@wine";
import type { BootPerformance } from "../boot-performance";
import type { Storage } from "../runtime/storage";

export interface CreateClientOptions {
  aria2: Aria2;
  wine: Wine;
  locale: Locale;
  storage?: Storage;
  bootPerformance?: BootPerformance;
}
