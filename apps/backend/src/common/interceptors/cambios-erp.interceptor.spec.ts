import { of, lastValueFrom } from "rxjs";
import { Reflector } from "@nestjs/core";
import { CambiosErpInterceptor } from "./cambios-erp.interceptor";

function contexto(method: string, que: string | undefined, user: any) {
  const reflector = { getAllAndOverride: jest.fn(() => que) } as unknown as Reflector;
  const prisma = { marcaCambioErp: { upsert: jest.fn(() => Promise.resolve({})) } };
  const ctx: any = {
    getType: () => "http",
    getHandler: () => null,
    getClass: () => null,
    switchToHttp: () => ({ getRequest: () => ({ method, user }) }),
  };
  return { interceptor: new CambiosErpInterceptor(reflector, prisma as any), ctx, prisma };
}

describe("CambiosErpInterceptor", () => {
  it("una modificación en el ERP mueve la marca de la empresa", async () => {
    const { interceptor, ctx, prisma } = contexto("PATCH", "Catálogo y precios", { empresaId: "emp-1" });
    await lastValueFrom(interceptor.intercept(ctx, { handle: () => of({ ok: true }) }));
    expect(prisma.marcaCambioErp.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { empresaId: "emp-1" } }));
  });

  it("una consulta (GET) no avisa", async () => {
    const { interceptor, ctx, prisma } = contexto("GET", "Catálogo y precios", { empresaId: "emp-1" });
    await lastValueFrom(interceptor.intercept(ctx, { handle: () => of([]) }));
    expect(prisma.marcaCambioErp.upsert).not.toHaveBeenCalled();
  });

  it("un controlador sin @AvisaTerminales no avisa", async () => {
    const { interceptor, ctx, prisma } = contexto("POST", undefined, { empresaId: "emp-1" });
    await lastValueFrom(interceptor.intercept(ctx, { handle: () => of({}) }));
    expect(prisma.marcaCambioErp.upsert).not.toHaveBeenCalled();
  });
});
