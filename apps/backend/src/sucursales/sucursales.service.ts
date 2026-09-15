import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class SucursalesService {
  constructor(private prisma: PrismaService) {}

  listar(empresaId: string) {
    return this.prisma.sucursal.findMany({ where: { empresaId, activo: true }, orderBy: { nombre: "asc" } });
  }

  obtener(id: string) {
    return this.prisma.sucursal.findUniqueOrThrow({
      where: { id },
      include: { areas: true, cajas: true, dispositivos: true },
    });
  }

  crear(data: {
    empresaId: string;
    nombre: string;
    direccion?: string;
    horarioApertura?: string;
    horarioCierre?: string;
    timezone?: string;
    moneda?: string;
    tasaImpuesto?: number;
  }) {
    return this.prisma.sucursal.create({ data });
  }

  actualizar(id: string, data: Partial<{ nombre: string; direccion: string; horarioApertura: string; horarioCierre: string; tasaImpuesto: number; activo: boolean }>) {
    return this.prisma.sucursal.update({ where: { id }, data });
  }

  // Config del ticket (plantilla de impresión: encabezado/pie, fuentes, ancho de papel, logo —
  // ver AdminTicket.tsx) vive dentro de configJson bajo la clave "ticket" en vez de columnas
  // propias: son ~20 campos de estilo que no se consultan por separado, solo se leen/escriben
  // como un bloque completo. Se mergea sobre el configJson existente para no perder otras claves
  // que ya pudiera tener (ej. a futuro).
  async actualizarConfigTicket(sucursalId: string, configTicket: unknown) {
    const sucursal = await this.prisma.sucursal.findUniqueOrThrow({ where: { id: sucursalId } });
    const configJson = { ...((sucursal.configJson as Record<string, unknown>) ?? {}), ticket: configTicket };
    return this.prisma.sucursal.update({ where: { id: sucursalId }, data: { configJson: configJson as Prisma.InputJsonValue } });
  }

  // --- Áreas ---
  crearArea(sucursalId: string, data: { nombre: string; tipo: string; descripcion?: string }) {
    return this.prisma.area.create({ data: { sucursalId, nombre: data.nombre, tipo: data.tipo as any, descripcion: data.descripcion } });
  }

  listarAreas(sucursalId: string) {
    return this.prisma.area.findMany({ where: { sucursalId, activo: true } });
  }

  // --- Dispositivos ---
  registrarDispositivo(data: { sucursalId: string; areaId?: string; nombre: string; tipo: string; identificador: string }) {
    return this.prisma.dispositivo.upsert({
      where: { identificador: data.identificador },
      update: { nombre: data.nombre, sucursalId: data.sucursalId, areaId: data.areaId, ultimaConexion: new Date(), activo: true },
      create: { ...data, tipo: data.tipo as any, ultimaConexion: new Date() },
    });
  }

  listarDispositivos(sucursalId: string) {
    return this.prisma.dispositivo.findMany({ where: { sucursalId, activo: true } });
  }

  // --- Cajas ---
  crearCaja(sucursalId: string, nombre: string) {
    return this.prisma.caja.create({ data: { sucursalId, nombre } });
  }

  listarCajas(sucursalId: string) {
    return this.prisma.caja.findMany({ where: { sucursalId, activo: true } });
  }
}
