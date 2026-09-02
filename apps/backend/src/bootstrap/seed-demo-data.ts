/* eslint-disable no-console */
import { PrismaClient, RolUsuario, TipoArea, TipoDispositivo } from "@prisma/client";
import * as bcrypt from "bcryptjs";

async function hash(v: string) {
  return bcrypt.hash(v, 10);
}

/**
 * Carga los datos demo de HANGAR 421 (empresa, 2 sucursales, catálogo, usuarios de cada rol).
 * Se usa tanto desde el CLI (`prisma/seed.ts`, `npm run db:seed`) como desde el arranque
 * automático del backend embebido en el POS Windows (ver `bootstrap/auto-bootstrap.ts`) —
 * misma lógica, una sola fuente de verdad.
 */
export async function seedDemoData(prisma: PrismaClient) {
  console.log("Sembrando datos demo de HANGAR 421...");

  // --- Empresa ---
  const empresa = await prisma.empresa.create({
    data: { nombre: "Café Hangar 421", rfc: "CHA210101ABC" },
  });

  // --- Sucursales ---
  const sucursalRoma = await prisma.sucursal.create({
    data: {
      empresaId: empresa.id,
      nombre: "Roma Norte",
      direccion: "Av. Álvaro Obregón 150, CDMX",
      horarioApertura: "07:00",
      horarioCierre: "21:00",
      tasaImpuesto: 0.16,
    },
  });
  const sucursalCondesa = await prisma.sucursal.create({
    data: {
      empresaId: empresa.id,
      nombre: "Condesa",
      direccion: "Av. Michoacán 30, CDMX",
      horarioApertura: "08:00",
      horarioCierre: "20:00",
      tasaImpuesto: 0.16,
    },
  });
  const sucursales = [sucursalRoma, sucursalCondesa];

  // --- Áreas, cajas, mesas por sucursal ---
  for (const suc of sucursales) {
    const salon = await prisma.area.create({ data: { sucursalId: suc.id, nombre: "Salón principal", tipo: TipoArea.SALON } });
    await prisma.area.create({ data: { sucursalId: suc.id, nombre: "Barra", tipo: TipoArea.BARRA } });
    const cocina = await prisma.area.create({ data: { sucursalId: suc.id, nombre: "Cocina", tipo: TipoArea.ESTACION_COCINA } });
    await prisma.caja.create({ data: { sucursalId: suc.id, nombre: "Caja 1" } });

    for (let i = 1; i <= 8; i++) {
      await prisma.mesa.create({
        data: { sucursalId: suc.id, areaId: salon.id, nombre: `Mesa ${i}`, capacidad: i % 3 === 0 ? 6 : 4 },
      });
    }

    await prisma.dispositivo.create({
      data: {
        sucursalId: suc.id,
        areaId: cocina.id,
        nombre: `POS Caja — ${suc.nombre}`,
        tipo: TipoDispositivo.POS_WINDOWS,
        identificador: `pos-${suc.id}`,
      },
    });
    await prisma.dispositivo.create({
      data: {
        sucursalId: suc.id,
        areaId: cocina.id,
        nombre: `Pantalla cocina — ${suc.nombre}`,
        tipo: TipoDispositivo.PANTALLA_COCINA,
        identificador: `kds-${suc.id}`,
      },
    });
  }

  // --- Categorías ---
  const categoriasData = [
    { nombre: "Café", orden: 1, color: "#6F4E37" },
    { nombre: "Bebidas frías", orden: 2, color: "#2563EB" },
    { nombre: "Panadería", orden: 3, color: "#E8A33D" },
    { nombre: "Desayunos", orden: 4, color: "#1F9D55" },
    { nombre: "Comidas", orden: 5, color: "#0B1E33" },
    { nombre: "Postres", orden: 6, color: "#DB2777" },
    { nombre: "Extras", orden: 7, color: "#6B7280" },
  ];
  const categorias: Record<string, string> = {};
  for (const c of categoriasData) {
    const cat = await prisma.categoriaProducto.create({ data: { empresaId: empresa.id, ...c } });
    categorias[c.nombre] = cat.id;
  }

  // --- Modificadores ---
  const modTamano = await prisma.modificador.create({
    data: {
      empresaId: empresa.id,
      nombre: "Tamaño",
      tipo: "SELECCION_UNICA",
      obligatorio: true,
      opciones: { create: [{ nombre: "Chico", precioExtra: 0, orden: 1 }, { nombre: "Grande", precioExtra: 12, orden: 2 }, { nombre: "XL", precioExtra: 20, orden: 3 }] },
    },
  });
  const modLeche = await prisma.modificador.create({
    data: {
      empresaId: empresa.id,
      nombre: "Tipo de leche",
      tipo: "SELECCION_UNICA",
      opciones: { create: [{ nombre: "Entera", precioExtra: 0, orden: 1 }, { nombre: "Deslactosada", precioExtra: 0, orden: 2 }, { nombre: "Avena", precioExtra: 10, orden: 3 }, { nombre: "Almendra", precioExtra: 12, orden: 4 }] },
    },
  });
  const modExtras = await prisma.modificador.create({
    data: {
      empresaId: empresa.id,
      nombre: "Extras",
      tipo: "MULTIPLE",
      opciones: { create: [{ nombre: "Shot extra", precioExtra: 15, orden: 1 }, { nombre: "Sin azúcar", precioExtra: 0, orden: 2 }, { nombre: "Canela", precioExtra: 5, orden: 3 }] },
    },
  });

  // --- Insumos ---
  const insumosData = [
    { nombre: "Café molido", unidadMedida: "g", costoUnitario: 0.4 },
    { nombre: "Leche entera", unidadMedida: "ml", costoUnitario: 0.02 },
    { nombre: "Vaso 12oz", unidadMedida: "pz", costoUnitario: 1.5 },
    { nombre: "Harina", unidadMedida: "g", costoUnitario: 0.03 },
    { nombre: "Mantequilla", unidadMedida: "g", costoUnitario: 0.1 },
  ];
  const insumos: Record<string, string> = {};
  for (const i of insumosData) {
    const ins = await prisma.insumo.create({ data: { empresaId: empresa.id, ...i } });
    insumos[i.nombre] = ins.id;
    for (const suc of sucursales) {
      await prisma.inventarioSucursal.create({
        data: { sucursalId: suc.id, insumoId: ins.id, existencia: 5000, minimo: 500 },
      });
    }
  }

  // --- Productos ---
  const productosData: { nombre: string; categoria: string; precio: number; conModificadores?: boolean; receta?: { insumo: string; cantidad: number }[] }[] = [
    { nombre: "Espresso", categoria: "Café", precio: 38, conModificadores: false, receta: [{ insumo: "Café molido", cantidad: 18 }] },
    { nombre: "Americano", categoria: "Café", precio: 42, conModificadores: true, receta: [{ insumo: "Café molido", cantidad: 18 }, { insumo: "Vaso 12oz", cantidad: 1 }] },
    { nombre: "Latte", categoria: "Café", precio: 49, conModificadores: true, receta: [{ insumo: "Café molido", cantidad: 18 }, { insumo: "Leche entera", cantidad: 200 }, { insumo: "Vaso 12oz", cantidad: 1 }] },
    { nombre: "Capuchino", categoria: "Café", precio: 52, conModificadores: true, receta: [{ insumo: "Café molido", cantidad: 18 }, { insumo: "Leche entera", cantidad: 150 }, { insumo: "Vaso 12oz", cantidad: 1 }] },
    { nombre: "Mocha", categoria: "Café", precio: 56, conModificadores: true },
    { nombre: "Flat White", categoria: "Café", precio: 54, conModificadores: true },
    { nombre: "Frappé", categoria: "Bebidas frías", precio: 62, conModificadores: true },
    { nombre: "Té chai frío", categoria: "Bebidas frías", precio: 50 },
    { nombre: "Limonada", categoria: "Bebidas frías", precio: 40 },
    { nombre: "Croissant de jamón y queso", categoria: "Panadería", precio: 65, receta: [{ insumo: "Harina", cantidad: 90 }, { insumo: "Mantequilla", cantidad: 25 }] },
    { nombre: "Concha", categoria: "Panadería", precio: 32, receta: [{ insumo: "Harina", cantidad: 80 }] },
    { nombre: "Bagel", categoria: "Panadería", precio: 45 },
    { nombre: "Chilaquiles verdes", categoria: "Desayunos", precio: 98 },
    { nombre: "Huevos al gusto", categoria: "Desayunos", precio: 89 },
    { nombre: "Sandwich club", categoria: "Comidas", precio: 110 },
    { nombre: "Ensalada César", categoria: "Comidas", precio: 105 },
    { nombre: "Cheesecake", categoria: "Postres", precio: 68 },
    { nombre: "Brownie", categoria: "Postres", precio: 48 },
    { nombre: "Shot extra de espresso", categoria: "Extras", precio: 15 },
  ];

  const productos: Record<string, string> = {};
  for (const p of productosData) {
    const producto = await prisma.producto.create({
      data: { empresaId: empresa.id, categoriaId: categorias[p.categoria], nombre: p.nombre, precioBase: p.precio },
    });
    productos[p.nombre] = producto.id;

    if (p.conModificadores) {
      await prisma.productoModificador.createMany({
        data: [
          { productoId: producto.id, modificadorId: modTamano.id, orden: 1 },
          { productoId: producto.id, modificadorId: modLeche.id, orden: 2 },
          { productoId: producto.id, modificadorId: modExtras.id, orden: 3 },
        ],
      });
    }
    if (p.receta) {
      await prisma.recetaItem.createMany({
        data: p.receta.map((r) => ({ productoId: producto.id, insumoId: insumos[r.insumo], cantidad: r.cantidad })),
      });
    }

    // catálogo centralizado, disponible en ambas sucursales al precio base
    for (const suc of sucursales) {
      await prisma.productoSucursal.create({
        data: { productoId: producto.id, sucursalId: suc.id, precio: p.precio, disponible: true },
      });
    }
  }
  // Ejemplo de override por sucursal: en Condesa el Frappé cuesta $5 más
  await prisma.productoSucursal.update({
    where: { productoId_sucursalId: { productoId: productos["Frappé"], sucursalId: sucursalCondesa.id } },
    data: { precio: 67 },
  });

  // --- Usuarios (un ejemplo de cada rol) ---
  const usuariosData: { nombre: string; email: string; password: string; pin: string; rol: RolUsuario; sucursales: string[] }[] = [
    { nombre: "Administrador Corporativo", email: "admin@hangar421.com", password: "Hangar421!", pin: "0000", rol: RolUsuario.ADMIN_CORPORATIVO, sucursales: [sucursalRoma.id, sucursalCondesa.id] },
    { nombre: "Laura Gómez", email: "laura.sucursal@hangar421.com", password: "Hangar421!", pin: "1111", rol: RolUsuario.ADMIN_SUCURSAL, sucursales: [sucursalRoma.id] },
    { nombre: "Ana Ramírez", email: "ana.cajero@hangar421.com", password: "Hangar421!", pin: "2222", rol: RolUsuario.CAJERO, sucursales: [sucursalRoma.id] },
    { nombre: "Carlos Martínez", email: "carlos.mesero@hangar421.com", password: "Hangar421!", pin: "3333", rol: RolUsuario.MESERO, sucursales: [sucursalRoma.id] },
    { nombre: "Diego Cocina", email: "diego.cocina@hangar421.com", password: "Hangar421!", pin: "4444", rol: RolUsuario.COCINA, sucursales: [sucursalRoma.id] },
    { nombre: "Sofía Supervisora", email: "sofia.supervisor@hangar421.com", password: "Hangar421!", pin: "5555", rol: RolUsuario.SUPERVISOR, sucursales: [sucursalRoma.id, sucursalCondesa.id] },
    { nombre: "Mesero Condesa", email: "mesero.condesa@hangar421.com", password: "Hangar421!", pin: "6666", rol: RolUsuario.MESERO, sucursales: [sucursalCondesa.id] },
  ];

  for (const u of usuariosData) {
    const usuario = await prisma.usuario.create({
      data: {
        empresaId: empresa.id,
        nombre: u.nombre,
        email: u.email,
        passwordHash: await hash(u.password),
        pinHash: await hash(u.pin),
      },
    });
    for (const sucursalId of u.sucursales) {
      await prisma.usuarioSucursal.create({ data: { usuarioId: usuario.id, sucursalId, rol: u.rol } });
    }
  }

  console.log("Listo. Credenciales demo (password para todos: Hangar421!):");
  for (const u of usuariosData) {
    console.log(`  ${u.rol.padEnd(20)} ${u.email.padEnd(32)} PIN ${u.pin}`);
  }
  console.log(`Empresa: ${empresa.id}`);
  console.log(`Sucursal Roma Norte: ${sucursalRoma.id}`);
  console.log(`Sucursal Condesa: ${sucursalCondesa.id}`);

  return { empresa, sucursales: [sucursalRoma, sucursalCondesa] };
}
