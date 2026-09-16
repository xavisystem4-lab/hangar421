import { Injectable, InternalServerErrorException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";

const ALGORITMO = "aes-256-gcm";
const IV_BYTES = 12;

/**
 * Cifra/descifra credenciales sensibles (tokens de Mercado Pago u otros proveedores de pago)
 * antes de guardarlas en `payment_provider_configs.credencialesCifradas` /
 * `payment_terminals.configuracionCifrada`. Nunca se exponen en texto plano al frontend — solo
 * el backend las descifra, y únicamente para llamar a la API del proveedor.
 *
 * La llave sale de PAGOS_CIFRADO_KEY (variable de entorno, nunca en el repo) — se deriva con
 * scrypt a una llave de 32 bytes sin importar la longitud del secreto original.
 */
@Injectable()
export class CifradoService {
  private readonly llave: Buffer;

  constructor(config: ConfigService) {
    const secreto = config.get<string>("PAGOS_CIFRADO_KEY");
    if (!secreto) {
      throw new InternalServerErrorException(
        "Falta configurar PAGOS_CIFRADO_KEY — requerida para cifrar credenciales de proveedores de pago.",
      );
    }
    this.llave = scryptSync(secreto, "hangar421-pagos-salt", 32);
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
