import { RolUsuario } from "@hangar421/shared";
import { AuthService } from "./auth.service";

/** Regresión: dos logins con el mismo usuario/sucursal en el mismo segundo deben producir
 *  tokens distintos (jti único) — antes de agregar `jti` al payload, el JWT resultante era
 *  byte-idéntico dentro del mismo segundo (mismo `iat`) y el segundo `refreshToken.create()`
 *  fallaba por el índice único de `tokenHash` (encontrado probando la app end-to-end). */
describe("AuthService — jti único por sesión", () => {
  function crearServicio() {
    const usuario = {
      id: "u1",
      empresaId: "e1",
      nombre: "Admin",
      activo: true,
      passwordHash: "hash",
      sucursales: [{ sucursalId: "s1", rol: RolUsuario.CAJERO, activo: true }],
    };

    const refreshTokensCreados: { tokenHash: string }[] = [];
    const prisma = {
      usuario: { findUnique: jest.fn().mockResolvedValue(usuario) },
      refreshToken: {
        create: jest.fn((args: any) => {
          refreshTokensCreados.push({ tokenHash: args.data.tokenHash });
          return Promise.resolve({ id: "rt1", ...args.data });
        }),
      },
    };

    const jwt = {
      // Firma determinista por contenido del payload — reproduce fielmente el bug real:
      // jsonwebtoken con el mismo payload + mismo "iat" (mismo segundo) produce el mismo
      // token. Si el payload no llevara `jti`, dos logins consecutivos generarían el mismo
      // string aquí, tal como ocurría con la librería real dentro del mismo segundo.
      sign: jest.fn((payload: any) => `signed:${JSON.stringify(payload)}`),
    };

    const config = { get: jest.fn((_key: string, def?: unknown) => def ?? "15m") };

    const bcrypt = require("bcryptjs");
    jest.spyOn(bcrypt, "compare").mockResolvedValue(true as never);

    const service = new AuthService(prisma as any, jwt as any, config as any);
    return { service, prisma, refreshTokensCreados };
  }

  it("no falla ni reutiliza tokenHash en dos logins consecutivos", async () => {
    const { service, refreshTokensCreados } = crearServicio();

    await service.loginConCredenciales({ email: "a@a.com", password: "x" } as any);
    await service.loginConCredenciales({ email: "a@a.com", password: "x" } as any);

    expect(refreshTokensCreados).toHaveLength(2);
    expect(refreshTokensCreados[0].tokenHash).not.toBe(refreshTokensCreados[1].tokenHash);
  });
});
