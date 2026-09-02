import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { ConfigService } from "@nestjs/config";
import { AppModule } from "./app.module";
import { PrismaService } from "./prisma/prisma.service";
import { autoBootstrap } from "./bootstrap/auto-bootstrap";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);

  // Solo en el backend embebido del POS Windows (modo standalone) — nunca en cloud.
  if (config.get<string>("AUTO_BOOTSTRAP") === "true") {
    await autoBootstrap(app.get(PrismaService));
  }

  const corsOrigins = config.get<string>("CORS_ORIGINS", "*").split(",");
  app.enableCors({ origin: corsOrigins, credentials: true });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
    }),
  );

  const apiPrefix = config.get<string>("API_PREFIX", "api/v1");
  app.setGlobalPrefix(apiPrefix);

  const swaggerConfig = new DocumentBuilder()
    .setTitle("HANGAR 421 API")
    .setDescription("Backend central — multisucursal, offline-first, tiempo real")
    .setVersion("0.1.0")
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup("api/docs", app, document);

  const port = config.get<number>("PORT", 3000);
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`HANGAR 421 backend escuchando en http://localhost:${port}/${apiPrefix}`);
  console.log(`Swagger: http://localhost:${port}/api/docs`);
}

bootstrap();
