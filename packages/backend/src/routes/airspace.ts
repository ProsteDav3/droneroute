import { Router } from "express";
import { fetchZones, listProviders } from "../services/airspace/index.js";
import { airspaceLimiter } from "../middleware/rateLimit.js";
import { logger } from "../lib/logger.js";

export const airspaceRoutes = Router();

/**
 * @openapi
 * /airspace/zones:
 *   get:
 *     summary: Get airspace restriction zones intersecting a bounding box
 *     description: >
 *       Zones are classified as "prohibited" (red) or "restricted" (orange).
 *       Rate-limited (airspaceLimiter) since this proxies external,
 *       rate-limited airspace providers.
 *     tags: [Airspace]
 *     security: []
 *     parameters:
 *       - in: query
 *         name: south
 *         required: true
 *         schema: { type: number }
 *       - in: query
 *         name: west
 *         required: true
 *         schema: { type: number }
 *       - in: query
 *         name: north
 *         required: true
 *         schema: { type: number }
 *       - in: query
 *         name: east
 *         required: true
 *         schema: { type: number }
 *       - in: query
 *         name: providers
 *         schema: { type: string }
 *         description: Comma-separated provider IDs (e.g. `enaire,dgac`). Omit to query all.
 *     responses:
 *       200:
 *         description: Zones intersecting the bounding box
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 zones: { type: array, items: { type: object } }
 *       400:
 *         description: Missing or invalid bounding-box parameters
 *       502:
 *         description: Upstream airspace provider request failed
 */
airspaceRoutes.get("/zones", airspaceLimiter, async (req, res) => {
  const { south, west, north, east, providers } = req.query;

  if (!south || !west || !north || !east) {
    res.status(400).json({
      error: "Chybí parametry ohraničení: south, west, north, east",
    });
    return;
  }

  const bounds = {
    south: Number(south),
    west: Number(west),
    north: Number(north),
    east: Number(east),
  };

  if (Object.values(bounds).some((v) => !Number.isFinite(v))) {
    res
      .status(400)
      .json({ error: "Parametry ohraničení musí být platná čísla" });
    return;
  }

  const providerIds =
    typeof providers === "string" && providers.length > 0
      ? providers.split(",").map((s) => s.trim())
      : undefined;

  try {
    const zones = await fetchZones(bounds, providerIds);
    res.json({ zones });
  } catch (err) {
    logger.error({ err }, "Airspace fetch error");
    res.status(502).json({ error: "Načtení dat o vzdušném prostoru selhalo" });
  }
});

/**
 * @openapi
 * /airspace/providers:
 *   get:
 *     summary: List available airspace providers
 *     tags: [Airspace]
 *     security: []
 *     responses:
 *       200:
 *         description: Providers
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 providers: { type: array, items: { type: object } }
 */
airspaceRoutes.get("/providers", (_req, res) => {
  res.json({ providers: listProviders() });
});
