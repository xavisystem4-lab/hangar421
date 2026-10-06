import { dividirEnStatements } from "./auto-bootstrap";

describe("dividirEnStatements", () => {
  it("parte por ';' de fin de línea y quita comentarios", () => {
    const sql = `-- CreateTable\nCREATE TABLE a (x int);\n\n-- AddColumn\nALTER TABLE a ADD COLUMN y int;\n`;
    expect(dividirEnStatements(sql)).toEqual(["CREATE TABLE a (x int)", "ALTER TABLE a ADD COLUMN y int"]);
  });

  it("deja un bloque DO $$ … $$ entero aunque lleve ';' por dentro", () => {
    const sql = `-- datos\nDO $$\nBEGIN\n  UPDATE a SET x = 1;\n  UPDATE a SET y = 2;\nEND $$;\nSELECT 1;\n`;
    const partes = dividirEnStatements(sql);
    expect(partes).toHaveLength(2);
    expect(partes[0]).toContain("UPDATE a SET y = 2;");
    expect(partes[0].endsWith("END $$")).toBe(true);
    expect(partes[1]).toBe("SELECT 1");
  });
});
