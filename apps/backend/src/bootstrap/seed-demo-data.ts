/* eslint-disable no-console */
import { PrismaClient, RolUsuario, TipoArea, TipoDispositivo, EstacionPreparacion } from "@prisma/client";
import * as bcrypt from "bcryptjs";

async function hash(v: string) {
  return bcrypt.hash(v, 10);
}

/** Versión del catálogo de HANGAR 421 Coffee Shop — se guarda en `Empresa.configJson.catalogoVersion`.
 *  Subirla (y agregar la lógica correspondiente en `cargarCatalogoHangar421`) es lo que dispara
 *  `bootstrap/auto-bootstrap.ts` a reemplazar el catálogo en una instalación que ya tenía datos
 *  (por ejemplo, una versión anterior del POS con el menú demo viejo) sin tocar usuarios,
 *  sucursales ni pedidos existentes. */
export const CATALOGO_VERSION = 2;

/**
 * Carga los datos base de HANGAR 421 (empresa, 2 sucursales, catálogo real de HANGAR 421
 * Coffee Shop, usuarios de cada rol). Se usa tanto desde el CLI (`prisma/seed.ts`,
 * `npm run db:seed`) como desde el arranque automático del backend embebido en el POS Windows
 * (ver `bootstrap/auto-bootstrap.ts`) — misma lógica, una sola fuente de verdad.
 */
export async function seedDemoData(prisma: PrismaClient) {
  console.log("Sembrando datos de HANGAR 421 Coffee Shop...");

  // --- Empresa ---
  const empresa = await prisma.empresa.create({
    data: { nombre: "HANGAR 421 Coffee Shop", rfc: "CHA210101ABC" },
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

  await cargarCatalogoHangar421(prisma, empresa.id, sucursales.map((s) => s.id));
  await prisma.empresa.update({ where: { id: empresa.id }, data: { configJson: { catalogoVersion: CATALOGO_VERSION } } });

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

  console.log("Listo. Credenciales (password para todos: Hangar421!):");
  for (const u of usuariosData) {
    console.log(`  ${u.rol.padEnd(20)} ${u.email.padEnd(32)} PIN ${u.pin}`);
  }
  console.log(`Empresa: ${empresa.id}`);
  console.log(`Sucursal Roma Norte: ${sucursalRoma.id}`);
  console.log(`Sucursal Condesa: ${sucursalCondesa.id}`);

  return { empresa, sucursales: [sucursalRoma, sucursalCondesa] };
}

/**
 * Catálogo real de HANGAR 421 Coffee Shop (categorías, modificadores y productos) — separado de
 * `seedDemoData` para poder reaplicarse sobre una empresa ya existente cuando sube
 * `CATALOGO_VERSION` (ver `bootstrap/auto-bootstrap.ts`), sin tocar usuarios/sucursales/pedidos.
 */
export async function cargarCatalogoHangar421(prisma: PrismaClient, empresaId: string, sucursalIds: string[]) {
  // --- Categorías (colores acordes al logotipo — ver apps/pos-desktop/src/theme/categoriaColores.ts) ---
  const categoriasData = [
    { nombre: "Bebidas frías", orden: 1, color: "#e8a33d" },
    { nombre: "Bebidas calientes", orden: 2, color: "#0b1e33" },
    { nombre: "Refresher", orden: 3, color: "#c97c4b" },
    { nombre: "Para llevar", orden: 4, color: "#5b7a63" },
    { nombre: "Postres", orden: 5, color: "#a4472f" },
    { nombre: "Combos", orden: 6, color: "#6d5875" },
    { nombre: "Extras", orden: 7, color: "#48586b" },
  ];
  const categorias: Record<string, string> = {};
  for (const c of categoriasData) {
    const cat = await prisma.categoriaProducto.create({ data: { empresaId: empresaId, ...c } });
    categorias[c.nombre] = cat.id;
  }

  // --- Modificadores ---
  // Tamaño y Tipo de leche: selección única y obligatoria — la primera opción (orden 1) queda
  // preseleccionada por defecto en el modal de personalización (Chico / Entera).
  const modTamano = await prisma.modificador.create({
    data: {
      empresaId: empresaId,
      nombre: "Tamaño",
      tipo: "SELECCION_UNICA",
      obligatorio: true,
      opciones: {
        create: [
          { nombre: "Chico", precioExtra: 0, orden: 1 },
          { nombre: "Grande", precioExtra: 12, orden: 2 },
          { nombre: "XL", precioExtra: 20, orden: 3 },
        ],
      },
    },
  });
  const modLeche = await prisma.modificador.create({
    data: {
      empresaId: empresaId,
      nombre: "Tipo de leche",
      tipo: "SELECCION_UNICA",
      obligatorio: true,
      opciones: {
        create: [
          { nombre: "Entera", precioExtra: 0, orden: 1 },
          { nombre: "Deslactosada", precioExtra: 0, orden: 2 },
          { nombre: "Avena", precioExtra: 25, orden: 3 },
          { nombre: "Almendra", precioExtra: 20, orden: 4 },
        ],
      },
    },
  });
  const modExtras = await prisma.modificador.create({
    data: {
      empresaId: empresaId,
      nombre: "Extras",
      tipo: "MULTIPLE",
      opciones: {
        create: [
          { nombre: "Shot extra", precioExtra: 25, orden: 1 },
          { nombre: "Sin azúcar", precioExtra: 0, orden: 2 },
          { nombre: "Canela", precioExtra: 5, orden: 3 },
          { nombre: "Gr de Matcha", precioExtra: 20, orden: 4 },
        ],
      },
    },
  });
  const modJarabe = await prisma.modificador.create({
    data: {
      empresaId: empresaId,
      nombre: "Jarabe",
      tipo: "MULTIPLE",
      opciones: {
        create: [
          { nombre: "Vainilla", precioExtra: 15, orden: 1 },
          { nombre: "Caramelo", precioExtra: 15, orden: 2 },
          { nombre: "Miel de agave", precioExtra: 15, orden: 3 },
          { nombre: "Cacao", precioExtra: 15, orden: 4 },
          { nombre: "Salted Caramel", precioExtra: 15, orden: 5 },
          { nombre: "Plátano", precioExtra: 15, orden: 6 },
        ],
      },
    },
  });
  const modColdFoam = await prisma.modificador.create({
    data: {
      empresaId: empresaId,
      nombre: "Cold Foam",
      tipo: "MULTIPLE",
      opciones: {
        create: [
          { nombre: "Blue Matcha", precioExtra: 25, orden: 1 },
          { nombre: "Matcha", precioExtra: 25, orden: 2 },
          { nombre: "Cajeta", precioExtra: 25, orden: 3 },
          { nombre: "Plátano", precioExtra: 25, orden: 4 },
          { nombre: "Vainilla", precioExtra: 25, orden: 5 },
        ],
      },
    },
  });
  // Jarabe incluido en los combos H&T / BnE&T (sin cargo — ya está contemplado en el precio del combo).
  const modJarabeEscoger = await prisma.modificador.create({
    data: {
      empresaId: empresaId,
      nombre: "Jarabe a escoger",
      tipo: "SELECCION_UNICA",
      obligatorio: true,
      opciones: {
        create: [
          { nombre: "Vainilla", precioExtra: 0, orden: 1 },
          { nombre: "Caramelo", precioExtra: 0, orden: 2 },
          { nombre: "Miel de agave", precioExtra: 0, orden: 3 },
          { nombre: "Cacao", precioExtra: 0, orden: 4 },
          { nombre: "Salted Caramel", precioExtra: 0, orden: 5 },
          { nombre: "Plátano", precioExtra: 0, orden: 6 },
        ],
      },
    },
  });

  // --- Productos — menú real de HANGAR 421 Coffee Shop ---
  // `personalizacion` ausente = sin modal, se agrega directo al pedido (no llevaba `*` en el menú).
  interface PersonalizacionSeed {
    tamano?: boolean;
    leche?: boolean;
    extras?: boolean;
    jarabe?: boolean;
    coldFoam?: boolean;
    jarabeEscoger?: boolean;
  }
  interface ProductoSeed {
    nombre: string;
    categoria: string;
    subcategoria?: string;
    descripcion?: string;
    precio: number;
    orden: number;
    estacion: EstacionPreparacion;
    personalizacion?: PersonalizacionSeed;
  }

  const MODAL_BEBIDA: PersonalizacionSeed = { tamano: true, leche: true, extras: true, jarabe: true, coldFoam: true };

  const productosData: ProductoSeed[] = [
    // Bebidas frías
    { nombre: "Latte", categoria: "Bebidas frías", precio: 85, orden: 1, estacion: "BARRA", personalizacion: MODAL_BEBIDA },
    { nombre: "Americano", categoria: "Bebidas frías", precio: 80, orden: 2, estacion: "BARRA" },
    { nombre: "Chai", categoria: "Bebidas frías", precio: 90, orden: 3, estacion: "BARRA", personalizacion: MODAL_BEBIDA },
    { nombre: "Dirty Chai", categoria: "Bebidas frías", precio: 105, orden: 4, estacion: "BARRA", personalizacion: MODAL_BEBIDA },
    { nombre: "Latte Maple y Sal", categoria: "Bebidas frías", precio: 100, orden: 5, estacion: "BARRA", personalizacion: MODAL_BEBIDA },
    { nombre: "Latte Amanecer", categoria: "Bebidas frías", precio: 125, orden: 6, estacion: "BARRA", personalizacion: MODAL_BEBIDA },
    { nombre: "Latte Chicago", categoria: "Bebidas frías", precio: 100, orden: 7, estacion: "BARRA", personalizacion: MODAL_BEBIDA },
    { nombre: "Matcha Iced Latte", categoria: "Bebidas frías", precio: 95, orden: 8, estacion: "BARRA", personalizacion: MODAL_BEBIDA },
    { nombre: "Espresso Tonic", categoria: "Bebidas frías", precio: 90, orden: 9, estacion: "BARRA" },
    { nombre: "Cold Brew Black Honey", categoria: "Bebidas frías", precio: 80, orden: 10, estacion: "BARRA" },

    // Bebidas calientes
    { nombre: "Latte", categoria: "Bebidas calientes", precio: 70, orden: 1, estacion: "BARRA", personalizacion: MODAL_BEBIDA },
    { nombre: "Americano", categoria: "Bebidas calientes", precio: 50, orden: 2, estacion: "BARRA" },
    { nombre: "Chai", categoria: "Bebidas calientes", precio: 85, orden: 3, estacion: "BARRA", personalizacion: MODAL_BEBIDA },
    { nombre: "Dirty Chai", categoria: "Bebidas calientes", precio: 100, orden: 4, estacion: "BARRA", personalizacion: MODAL_BEBIDA },
    { nombre: "Flat White", categoria: "Bebidas calientes", precio: 70, orden: 5, estacion: "BARRA", personalizacion: MODAL_BEBIDA },
    { nombre: "Capuccino", categoria: "Bebidas calientes", precio: 85, orden: 6, estacion: "BARRA", personalizacion: MODAL_BEBIDA },
    { nombre: "Matcha", categoria: "Bebidas calientes", precio: 80, orden: 7, estacion: "BARRA", personalizacion: MODAL_BEBIDA },

    // Refresher
    { nombre: "Nebula Tonic", categoria: "Refresher", precio: 105, orden: 1, estacion: "BARRA" },
    { nombre: "Coco Matcha Cloud", categoria: "Refresher", precio: 100, orden: 2, estacion: "BARRA" },
    { nombre: "Dirty Piña Colada", categoria: "Refresher", precio: 110, orden: 3, estacion: "BARRA" },

    // Para llevar
    { nombre: "To Go", categoria: "Para llevar", precio: 115, orden: 1, estacion: "BARRA" },
    { nombre: "Bomba", categoria: "Para llevar", precio: 55, orden: 2, estacion: "BARRA" },

    // Postres — Galletas by Domingo
    { nombre: "Macadamia", categoria: "Postres", subcategoria: "Galletas by Domingo", precio: 75, orden: 1, estacion: "POSTRES" },
    { nombre: "Chispas y Nuez", categoria: "Postres", subcategoria: "Galletas by Domingo", precio: 65, orden: 2, estacion: "POSTRES" },
    { nombre: "Pistache", categoria: "Postres", subcategoria: "Galletas by Domingo", precio: 80, orden: 3, estacion: "POSTRES" },

    // Postres — Roles de Canela by Törtchen
    { nombre: "Queso Crema", categoria: "Postres", subcategoria: "Roles de Canela by Törtchen", precio: 145, orden: 4, estacion: "POSTRES" },
    { nombre: "Pistache", categoria: "Postres", subcategoria: "Roles de Canela by Törtchen", precio: 155, orden: 5, estacion: "POSTRES" },

    // Postres — Chunky Cookies
    { nombre: "Red Velvet", categoria: "Postres", subcategoria: "Chunky Cookies", precio: 55, orden: 6, estacion: "POSTRES" },
    { nombre: "Zanahoria", categoria: "Postres", subcategoria: "Chunky Cookies", precio: 50, orden: 7, estacion: "POSTRES" },

    // Combos
    {
      nombre: "H & T",
      categoria: "Combos",
      precio: 250,
      orden: 1,
      estacion: "COCINA",
      descripcion: "Huevo revuelto, tocino, miel de maple, queso Philadelphia, pan de French toast. Incluye bebida To Go Latte Natural y jarabe a escoger.",
      personalizacion: { jarabeEscoger: true },
    },
    {
      nombre: "Solo Bagel",
      categoria: "Combos",
      precio: 155,
      orden: 2,
      estacion: "COCINA",
      descripcion: "Bagel — variante incluida en el combo H & T.",
    },
    {
      nombre: "BnE & T",
      categoria: "Combos",
      precio: 250,
      orden: 3,
      estacion: "COCINA",
      descripcion: "Bagel con pan plain o de ajo, huevo revuelto, tocino, queso americano. Incluye bebida To Go Latte Natural y jarabe a escoger.",
      personalizacion: { jarabeEscoger: true },
    },
    {
      nombre: "Solo Bagel",
      categoria: "Combos",
      precio: 140,
      orden: 4,
      estacion: "COCINA",
      descripcion: "Bagel — variante incluida en el combo BnE & T.",
    },

    // Extras
    { nombre: "Café de bebé (choco milk)", categoria: "Extras", precio: 40, orden: 1, estacion: "BARRA" },
  ];

  const productos: Record<string, string> = {};
  for (const p of productosData) {
    const producto = await prisma.producto.create({
      data: {
        empresaId: empresaId,
        categoriaId: categorias[p.categoria],
        nombre: p.nombre,
        descripcion: p.descripcion,
        subcategoria: p.subcategoria,
        precioBase: p.precio,
        orden: p.orden,
        estacionPreparacion: p.estacion,
        requierePersonalizacion: !!p.personalizacion,
      },
    });
    // Los dos "Solo Bagel" comparten nombre — se distinguen por precio/descripción, así que
    // se indexan por id compuesto (nombre + precio) en vez de solo nombre.
    productos[`${p.nombre}#${p.precio}`] = producto.id;

    if (p.personalizacion) {
      const links: { modificadorId: string; orden: number }[] = [];
      let orden = 1;
      if (p.personalizacion.tamano) links.push({ modificadorId: modTamano.id, orden: orden++ });
      if (p.personalizacion.leche) links.push({ modificadorId: modLeche.id, orden: orden++ });
      if (p.personalizacion.extras) links.push({ modificadorId: modExtras.id, orden: orden++ });
      if (p.personalizacion.jarabe) links.push({ modificadorId: modJarabe.id, orden: orden++ });
      if (p.personalizacion.coldFoam) links.push({ modificadorId: modColdFoam.id, orden: orden++ });
      if (p.personalizacion.jarabeEscoger) links.push({ modificadorId: modJarabeEscoger.id, orden: orden++ });
      await prisma.productoModificador.createMany({
        data: links.map((l) => ({ productoId: producto.id, ...l })),
      });
    }

    // catálogo centralizado, disponible en todas las sucursales al precio base (sin inventario/
    // receta — no se especificaron ingredientes ni cantidades en el menú, queda configurable por
    // admin)
    for (const sucursalId of sucursalIds) {
      await prisma.productoSucursal.create({
        data: { productoId: producto.id, sucursalId, precio: p.precio, disponible: true },
      });
    }
  }

  console.log(`[catalogo] ${productosData.length} productos cargados para empresa ${empresaId}.`);
}
