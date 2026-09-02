import { SetMetadata } from "@nestjs/common";

/** Marca un endpoint como público (sin JWT), p.ej. login y health-check. */
export const IS_PUBLIC_KEY = "isPublic";
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
