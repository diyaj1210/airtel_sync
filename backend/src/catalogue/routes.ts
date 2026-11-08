import { Router } from "express";
import { buildBundle, TEMPLATES } from "./bundles.js";
import type { Catalogue } from "./catalogue.js";
import { checkProduct } from "./rules.js";
import { parseBuildRequest, parseEligibilityRequest } from "./validate.js";

/**
 * Read-only catalogue API (step 1). Quote (step 2) and advisor (step 3) build on it.
 *   GET  /api/catalogue            all 25 products
 *   GET  /api/bundles/templates    the segment bundle templates
 *   POST /api/eligibility          { profile, productIds } -> per-product eligibility + reasons
 *   POST /api/bundles/build        { segment, variant?, profile } -> eligible bundle + price + add-ons
 */
export function catalogueRouter(catalogue: Catalogue): Router {
  const router = Router();

  router.get("/catalogue", (_req, res) => {
    res.json({ products: catalogue.products });
  });

  router.get("/bundles/templates", (_req, res) => {
    res.json({
      templates: TEMPLATES.map((t) => ({ id: t.id, segment: t.segment, variant: t.variant, name: t.name })),
    });
  });

  router.post("/eligibility", (req, res) => {
    const parsed = parseEligibilityRequest(req.body, (id) => catalogue.has(id));
    if (!parsed.ok) {
      res.status(400).json({ error: "invalid_request", details: parsed.errors });
      return;
    }
    const { profile, productIds } = parsed.value;
    res.json({
      results: productIds.map((id) => {
        const violations = checkProduct(catalogue.get(id), profile, productIds);
        return { productId: id, eligible: violations.length === 0, violations };
      }),
    });
  });

  router.post("/bundles/build", (req, res) => {
    const parsed = parseBuildRequest(req.body);
    if (!parsed.ok) {
      res.status(400).json({ error: "invalid_request", details: parsed.errors });
      return;
    }
    const { segment, variant, profile } = parsed.value;
    res.json(buildBundle(catalogue, segment, profile, variant));
  });

  return router;
}
