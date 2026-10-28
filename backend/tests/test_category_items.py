"""Category → item → spec template regressions, using isolated SQLite.

Run from backend: venv/Scripts/python.exe -m unittest discover -s tests -v
"""
import json
import os
import unittest
from datetime import datetime, timedelta
from unittest.mock import patch

os.environ["DATABASE_URL"] = "sqlite://"

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel, Session, create_engine

from app.api.routes.business import router as business_router
from app.api.routes.meta import router as meta_router
from app.api.routes.requirements import router as requirements_router
from app.core.categories import ATTRIBUTES, CATEGORIES, get_item_specs, items_for
from app.core.security import get_current_user, require_buyer
from app.core.units import normalize as normalize_units
from app.models.requirement import Requirement
from app.models.user import User
from app.services import requirement_service as requirement_service_module
from app.services import spec_suggestion_service
from app.services.requirement_service import requirement_service


class CategoryItemTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        SQLModel.metadata.create_all(self.engine)
        for target in ("app.services.business_service.engine", "app.services.requirement_service.engine"):
            p = patch(target, self.engine)
            p.start()
            self.addCleanup(p.stop)
        # Keeps the local embedding model and Qdrant out of the tests.
        for target in ("app.services.business_service.matching_service", "app.services.requirement_service.matching_service"):
            p = patch(target)
            p.start().embed_to_json.return_value = ""
            self.addCleanup(p.stop)
        self.addCleanup(self.engine.dispose)

        self.seller = self.save(User(business_name="Seller", role="seller", industry_category="Printing"))
        self.buyer = self.save(User(business_name="Buyer", role="buyer", industry_category="Printing",
                                    is_verified=True, verification_status="verified"))
        self.app = FastAPI()
        self.app.include_router(business_router, prefix="/business")
        self.app.include_router(requirements_router, prefix="/requirements")
        self.app.include_router(meta_router, prefix="/meta")
        self.client = TestClient(self.app)

    def save(self, record):
        with Session(self.engine) as session:
            session.add(record)
            session.commit()
            session.refresh(record)
            session.expunge(record)
            return record

    def load(self, model, record_id):
        with Session(self.engine) as session:
            return session.get(model, record_id)

    # ---------- onboarding ----------

    def onboard(self, user, **overrides):
        self.app.dependency_overrides[get_current_user] = lambda: user
        payload = dict(
            registered_name="Santiago Printing", business_type="SOLE_PROP", city="Pasig",
            province="Metro Manila", contact_person="Ana Santiago", contact_mobile="+63 917 555 0142",
            capabilities=["Offset printing", "Digital printing", "Bookbinding"], service_areas=["Pasig"],
            offered_items=[{"code": "tarpaulin"}],
        )
        payload.update(overrides)
        return self.client.post("/business/onboarding", json=payload)

    def test_onboarding_without_category_keeps_registration_value(self):
        self.assertEqual(self.onboard(self.seller).status_code, 204)
        user = self.load(User, self.seller.id)
        self.assertEqual(user.industry_category, "Printing")
        self.assertEqual(json.loads(user.offered_items), [{"code": "tarpaulin", "other_text": None}])

    def test_legacy_user_without_category_and_none_sent_is_rejected(self):
        legacy = self.save(User(business_name="Legacy", role="seller"))
        self.assertEqual(self.onboard(legacy).status_code, 422)
        self.assertEqual(self.onboard(legacy, industry_category="Printing").status_code, 204)

    def test_invalid_category_is_rejected(self):
        self.assertEqual(self.onboard(self.seller, industry_category="Construction").status_code, 422)

    def test_editing_items_keeps_category_and_verified_status(self):
        # After onboarding the category is locked (change_request_service);
        # items within it stay editable.
        verified = self.save(User(business_name="Verified", role="seller", industry_category="Printing",
                                  is_verified=True, verification_status="verified", onboarding_completed=True))
        response = self.onboard(verified, industry_category="Packaging & Labeling",
                                offered_items=[{"code": "tarpaulin"}, {"code": "other", "other_text": "Gift boxes"}])
        self.assertEqual(response.status_code, 204)
        user = self.load(User, verified.id)
        self.assertEqual(user.industry_category, "Printing")
        self.assertTrue(user.is_verified)
        self.assertEqual(user.verification_status, "verified")

    def test_items_must_belong_to_the_category(self):
        self.assertEqual(self.onboard(self.seller, offered_items=[{"code": "paper_bags"}]).status_code, 422)
        self.assertEqual(self.onboard(self.seller, offered_items=[{"code": "other"}]).status_code, 422)

    def test_seller_needs_at_least_one_item_buyer_needs_none(self):
        self.assertEqual(self.onboard(self.seller, offered_items=[]).status_code, 422)
        self.assertEqual(self.onboard(self.buyer, offered_items=[], capabilities=[], service_areas=[]).status_code, 204)
        self.assertIsNone(self.load(User, self.buyer.id).offered_items)

    # ---------- requirements ----------

    def post_requirement(self, **overrides):
        self.app.dependency_overrides[require_buyer] = lambda: self.buyer
        payload = dict(
            category="Printing", item_code="tarpaulin", title="Event tarpaulins", scope="Tarpaulins for a store opening.",
            specifications=[{"label": "Size (ft)", "value": "3 x 6"}, {"label": "Finish", "value": "Matte"},
                            {"label": "Eyelets", "value": "Corners only"},
                            {"label": "Artwork", "value": "Print-ready file provided"}],
            quantity="10 pcs", price_min=1000, price_max=2000, city="Pasig", site_address="Unit 4B, Ortigas Ave.",
            required_documents=["BIR 2303"], closes_at=(datetime.now() + timedelta(days=7)).isoformat(),
        )
        payload.update(overrides)
        return self.client.post("/requirements", json=payload)

    # Tarpaulin's required rows besides Size: Artwork (category), Finish, Eyelets.
    TARP_REST = [{"attribute_id": "artwork", "label": "Artwork", "value": "Print-ready file provided"},
                 {"attribute_id": "finish", "label": "Finish", "value": "Matte"},
                 {"attribute_id": "eyelets", "label": "Eyelets", "value": "Corners only"}]

    def test_requirement_with_template_item_is_accepted(self):
        response = self.post_requirement()
        self.assertEqual(response.status_code, 201, response.text)
        self.assertEqual(response.json()["item_code"], "tarpaulin")
        self.assertEqual(response.json()["item_name"], "Tarpaulin")

    def test_requirement_item_outside_its_category_is_rejected(self):
        self.assertEqual(self.post_requirement(item_code="paper_bags").status_code, 422)

    def test_requirement_missing_required_template_spec_is_rejected(self):
        response = self.post_requirement(specifications=[{"label": "Finish", "value": "Matte"}])
        self.assertEqual(response.status_code, 422)
        self.assertIn("Size (ft)", response.text)

    def test_requirement_select_spec_must_use_an_option(self):
        specs = [{"label": "Size (ft)", "value": "3 x 6"}, {"label": "Finish", "value": "Satin"}]
        self.assertEqual(self.post_requirement(specifications=specs).status_code, 422)

    def test_requirement_other_item_accepts_free_form_specs(self):
        response = self.post_requirement(item_code="other",
                                         specifications=[{"label": "Anything", "value": "Goes"},
                                                         {"label": "Artwork", "value": "Needs layout / design"}])
        self.assertEqual(response.status_code, 201, response.text)

    def test_existing_requirement_with_null_item_still_loads(self):
        legacy = self.save(Requirement(ref_code="REQ-OLD", title="Old", owner_id=self.buyer.id, category="Printing",
                                       location="Pasig", closes_at=datetime.now() + timedelta(days=1)))
        out = requirement_service.get_by_id(legacy.id)
        self.assertIsNone(out.item_code)
        self.assertIsNone(out.item_name)
        mine = requirement_service.list_my_requirements(self.buyer.id)
        self.assertEqual([r.item_code for r in mine], [None])

    def flyer_specs(self, **values):
        specs = {"size": ("Size", "A4"), "fold": ("Fold", "Tri-fold"), "paper_type": ("Paper", "Glossy"),
                 "printed_sides": ("Printed sides", "2 sides"), "artwork": ("Artwork", "Print-ready file provided")}
        specs.update(values)
        return [{"attribute_id": k, "label": label, "value": v} for k, (label, v) in specs.items()]

    def test_requirement_number_spec_must_be_numeric(self):
        specs = self.flyer_specs(paper_weight=("Paper weight (gsm)", "makapal"))
        response = self.post_requirement(item_code="flyers_brochures", specifications=specs)
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["detail"], "Paper weight (gsm) must be a number.")
        specs = self.flyer_specs(paper_weight=("Paper weight (gsm)", "inf"))
        self.assertEqual(self.post_requirement(item_code="flyers_brochures", specifications=specs).status_code, 422)
        specs = self.flyer_specs(paper_weight=("Paper weight (gsm)", "120"))
        self.assertEqual(self.post_requirement(item_code="flyers_brochures", specifications=specs).status_code, 201)

    def test_requirement_quantity_needs_a_number_and_unit(self):
        self.assertEqual(self.post_requirement(quantity="marami").status_code, 422)
        self.assertEqual(self.post_requirement(quantity="10").status_code, 422)  # no unit
        self.assertEqual(self.post_requirement(quantity="10 dozen").status_code, 422)
        self.assertEqual(self.post_requirement(quantity="1,000 pcs").status_code, 201)
        # A count, not a measurement: whole numbers above 0 only.
        for bad in ("0 pcs", "2.5 pcs", "-5 pcs", "12345678 pcs", "5a pcs"):
            self.assertEqual(self.post_requirement(quantity=bad).status_code, 422, bad)

    def test_validation_message_is_the_plain_frontend_wording(self):
        response = self.post_requirement(specifications=[])
        self.assertEqual(response.json()["detail"], "Add a value for Size (ft) — it's required for Tarpaulin.")

    def test_preferred_brand_is_optional_stored_by_id_and_kept_out_of_matching(self):
        self.assertEqual(self.post_requirement().status_code, 201)  # no brand at all
        specs = [{"attribute_id": "size", "label": "Size (ft)", "value": "3 x 6"},
                 {"attribute_id": "preferred_brand", "label": "Preferred brand", "value": "Epson"}] + self.TARP_REST
        response = self.post_requirement(specifications=specs)
        self.assertEqual(response.status_code, 201, response.text)
        rows = response.json()["specifications"]
        self.assertIn({"attribute_id": "preferred_brand", "value": "Epson"},
                      [{"attribute_id": r["attribute_id"], "value": r["value"]} for r in rows])
        matching = requirement_service_module.matching_service.requirement_matching_text
        self.assertNotIn("Epson", " ".join(str(a) for a in matching.call_args.args))

    def test_template_rows_keep_attribute_id_and_normalized_units(self):
        specs = [{"attribute_id": "size", "label": "Size (ft)", "value": "3 x 6"},
                 {"label": "Haba ng tali", "value": "2 m"}] + self.TARP_REST
        response = self.post_requirement(specifications=specs)
        self.assertEqual(response.status_code, 201, response.text)
        rows = response.json()["specifications"]
        size = next(r for r in rows if r["attribute_id"] == "size")
        custom = next(r for r in rows if r["label"] == "Haba ng tali")
        self.assertEqual((size["attribute_id"], size["value"]), ("size", "3 x 6"))
        self.assertEqual((size["normalized_value"], size["normalized_unit"]), ("91.44 x 182.88", "cm"))
        self.assertEqual((custom["attribute_id"], custom["normalized_value"], custom["normalized_unit"]), (None, "200", "cm"))

    def test_unknown_attribute_id_is_rejected(self):
        specs = [{"attribute_id": "size", "label": "Size (ft)", "value": "3 x 6"},
                 {"attribute_id": "not_a_thing", "label": "X", "value": "Y"}] + self.TARP_REST
        self.assertEqual(self.post_requirement(specifications=specs).status_code, 422)

    # ---------- meta ----------

    def test_meta_categories_is_public_and_every_category_has_other(self):
        response = self.client.get("/meta/categories")
        self.assertEqual(response.status_code, 200)
        self.assertEqual([c["name"] for c in response.json()], CATEGORIES)
        for category in CATEGORIES:
            self.assertEqual(items_for(category)[-1]["code"], "other")

    def test_meta_attributes_lists_the_dictionary(self):
        response = self.client.get("/meta/attributes")
        self.assertEqual(response.status_code, 200)
        by_id = {a["id"]: a for a in response.json()}
        self.assertEqual(set(by_id), set(ATTRIBUTES))
        self.assertEqual((by_id["paper_weight"]["type"], by_id["paper_weight"]["unit"]), ("number", "gsm"))
        self.assertIn("kapal ng papel", by_id["paper_weight"]["synonyms"])


class SpecLayerTests(unittest.TestCase):
    GENERAL = ["quantity", "unit", "size", "color", "preferred_brand", "remarks"]

    def test_layers_merge_general_then_category_then_item(self):
        ids = [s["id"] for s in get_item_specs("Printing", "tarpaulin")]
        self.assertEqual(ids, self.GENERAL + ["artwork", "finish", "eyelets"])

    def test_item_layer_overrides_required_and_unit(self):
        general_size = next(s for s in get_item_specs("Printing", "other") if s["id"] == "size")
        tarp_size = next(s for s in get_item_specs("Printing", "tarpaulin") if s["id"] == "size")
        self.assertFalse(general_size["required"])
        self.assertTrue(tarp_size["required"])
        self.assertEqual(tarp_size["unit"], "ft")
        quantity = next(s for s in get_item_specs("Printing", "tarpaulin") if s["id"] == "quantity")
        self.assertTrue(quantity["required"])

    def test_other_item_gets_general_and_category_specs_only(self):
        self.assertEqual([s["id"] for s in get_item_specs("Printing", "other")], self.GENERAL + ["artwork"])
        self.assertEqual([s["id"] for s in get_item_specs("Packaging & Labeling", "other")],
                         self.GENERAL + ["artwork", "food_grade"])

    def test_every_item_spec_is_a_dictionary_attribute(self):
        for category in CATEGORIES:
            for item in items_for(category):
                for spec in get_item_specs(category, item["code"]):
                    self.assertIn(spec["id"], ATTRIBUTES)
                    if spec["type"] == "select":
                        self.assertTrue(spec["options"], f"{item['code']}.{spec['id']} has no options")


class UnitTests(unittest.TestCase):
    def test_normalizes_to_the_standard_unit(self):
        self.assertEqual(normalize_units("3 x 6", "ft"), ("91.44 x 182.88", "cm"))
        self.assertEqual(normalize_units("36 x 72 in", None), ("91.44 x 182.88", "cm"))
        self.assertEqual(normalize_units("120gsm", None), ("120", "gsm"))
        self.assertEqual(normalize_units("120", "gsm"), ("120", "gsm"))
        self.assertEqual(normalize_units("2 mil", None), ("50.8", "microns"))

    def test_free_text_is_left_alone(self):
        self.assertIsNone(normalize_units("Custom", None))
        self.assertIsNone(normalize_units("A4", None))
        self.assertIsNone(normalize_units("3 x 6", None))  # no unit anywhere
        self.assertIsNone(normalize_units("3 ft x 20 gsm", None))  # mixed kinds


def _fake_vector(text: str) -> list[float]:
    # Deterministic stand-in for the model: paper-ish phrases point one way,
    # everything else another.
    return [1.0, 0.0] if "paper" in text or "papel" in text else [0.0, 1.0]


class SpecSuggestionTests(unittest.TestCase):
    def setUp(self):
        spec_suggestion_service._phrase_vectors = None
        self.addCleanup(setattr, spec_suggestion_service, "_phrase_vectors", None)

    def test_kapal_ng_papel_suggests_paper_weight(self):
        with patch.object(spec_suggestion_service.matching_service, "embed") as embed:
            out = spec_suggestion_service.suggest("Kapal ng papel", "Printing", "flyers_brochures")
            embed.assert_not_called()  # synonym hit, no model needed
        self.assertEqual(out["attribute_id"], "paper_weight")
        self.assertEqual((out["label"], out["unit"]), ("Paper weight", "gsm"))
        self.assertEqual(spec_suggestion_service.suggest("kapal ng papel (gsm)")["attribute_id"], "paper_weight")

    def test_below_threshold_gives_no_suggestion(self):
        with patch.object(spec_suggestion_service.matching_service, "embed_many",
                          side_effect=lambda texts: [_fake_vector(t.lower()) for t in texts]), \
             patch.object(spec_suggestion_service.matching_service, "embed",
                          return_value=[0.5, 0.866]):  # cosine 0.5 / 0.866 vs the two directions
            self.assertIsNotNone(spec_suggestion_service.suggest("whatever"))  # 0.866 clears 0.82
            spec_suggestion_service._phrase_vectors = None
        with patch.object(spec_suggestion_service.matching_service, "embed_many",
                          side_effect=lambda texts: [_fake_vector(t.lower()) for t in texts]), \
             patch.object(spec_suggestion_service.matching_service, "embed", return_value=[0.6, 0.8]):
            self.assertIsNone(spec_suggestion_service.suggest("whatever"))  # 0.80 < 0.82

    def test_model_failure_gives_no_suggestion_instead_of_an_error(self):
        with patch.object(spec_suggestion_service.matching_service, "embed_many", return_value=[]), \
             patch.object(spec_suggestion_service.matching_service, "embed", return_value=[]):
            self.assertIsNone(spec_suggestion_service.suggest("Delivery schedule"))

    @unittest.skipUnless(os.environ.get("RUN_MODEL_TESTS"), "set RUN_MODEL_TESTS=1 to load the real embedding model")
    def test_real_model_threshold(self):
        for unrelated in ("Payment terms", "Delivery schedule", "Ink type", "Rounded corners"):
            self.assertIsNone(spec_suggestion_service.suggest(unrelated), unrelated)
        for label, attribute_id in (("Paper thickness gsm", "paper_weight"), ("Zip closure", "zipper"),
                                    ("Box flute", "box_wall"), ("Lamination type", "lamination")):
            self.assertEqual(spec_suggestion_service.suggest(label)["attribute_id"], attribute_id, label)


if __name__ == "__main__":
    unittest.main()
