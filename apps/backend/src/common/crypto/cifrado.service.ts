import { Injectable, InternalServerErrorException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";

const ALGORITMO = "aes-256-gcm";
const IV_BYTES = 12;

/**
 * Cifra/descifra credenciales sensibles (tokens de Mercado Pago, credenciales de plataformas de
 * delivery, etc.) antes de guardarlas en `payment_provider_configs.credencialesCifradas` /
 * `payment_terminals.configuracionCifrada` / `plataforma_configs.credencialesCifradas`. Nunca se
 * exponen en texto plano al frontend — solo el backend las descifra, y únicamente para llamar a
 * la API del proveedor/plataforma correspondiente.
 *
 * La llave sale de una variable de entorno (nunca en el repo) — se deriva con scrypt a una llave
 * de 32 bytes sin importar la longitud del secreto original. Por defecto usa PAGOS_CIFRADO_KEY
 * (retrocompatible con el uso original en `pagos/`); un módulo distinto puede pedir su propia
 * llave (ej. PLATAFORMAS_CIFRADO_KEY) pasando un segundo argumento al construirlo — así un
 * problema/fuga en un dominio no expone el material de cifrado del otro. El salt de
 * PAGOS_CIFRADO_KEY se mantiene literal (no depende del nombre de la variable) para no invalidar
 * las credenciales de pagos ya cifradas en producción.
 */
@Injectable()
export class CifradoService {
  private readonly llave: Buffer;

  constructor(config: ConfigService, private readonly nombreVariableEntorno: string = "PAGOS_CIFRADO_KEY") {
    const secreto = config.get<string>(this.nombreVariableEntorno);
    if (!secreto) {
      throw new InternalServerErrorException(
        `Falta configurar ${this.nombreVariableEntorno} — requerida para cifrar credenciales sensibles.`,
      );
    }
    const salt = this.nombreVariableEntorno === "PAGOS_CIFRADO_KEY"
      ? "hangar421-pagos-salt"
      : `hangar421-${this.nombreVariableEntorno.toLowerCase()}-salt`;
    this.llave = scryptSync(secreto, salt, 32);
  }

  cifrar(texto: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITMO, this.llave, iv);
    const cifrado = Buffer.concat([cipher.update(texto, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    // iv.tag.cifrado, todo en base64 — formato compacto para guardar en una sola columna String.
    return `${iv.toString("base64")}.${tag.toString("base64")}.${cifrado.toString("base64")}`;
  }

  descifrar(valor: string): string {
    const [ivB64, tagB64, dataB64] = valor.split(".");
    if (!ivB64 || !tagB64 || !dataB64) {
      throw new InternalServerErrorException("Formato de credencial cifrada inválido");
    }
    const decipher = createDecipheriv(ALGORITMO, this.llave, Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    const texto = Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]);
    return texto.toString("utf8");
  }

  cifrarJson(valor: unknown): string {
    return this.cifrar(JSON.stringify(valor));
  }

  descifrarJson<T>(valor: string): T {
    return JSON.parse(this.descifrar(valor)) as T;
  }
}
