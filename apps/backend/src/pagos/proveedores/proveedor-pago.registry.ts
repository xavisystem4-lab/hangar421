import { Injectable, NotFoundException } from "@nestjs/common";
import { MercadoPagoAdapter } from "./mercadopago.adapter";
import { MockPagoAdapter } from "./mock.adapter";
import { ProveedorPagoAdapter } from "./proveedor-pago.interface";

/**
 * Punto único de extensión: agregar un banco/proveedor nuevo es escribir una clase que
 * implemente ProveedorPagoAdapter y añadirla aquí — PagosService, los controladores y el resto
 * del módulo de pagos solo conocen la interfaz, nunca un proveedor concreto.
 */
@Injectable()
export class ProveedorPagoRegistry {
  private readonly adaptadores: Map<string, ProveedorPagoAdapter>;

  constructor(mercadoPago: MercadoPagoAdapter, mock: MockPagoAdapter) {
    this.adaptadores = new Map<string, ProveedorPagoAdapter>([
      [mercadoPago.codigo, mercadoPago],
      [mock.codigo, mock],
    ]);
  }

  obtener(codigo: string): ProveedorPagoAdapter {
    const adaptador = this.adaptadores.get(codigo);
    if (!adaptador) throw new NotFoundException(`Proveedor de pago "${codigo}" no está registrado`);
    return adaptador;
  }

  listarCodigos(): string[] {
    return Array.from(this.adaptadores.keys());
  }
}
