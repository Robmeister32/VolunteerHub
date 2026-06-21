import assert from "node:assert/strict";
import { test } from "node:test";
import { formatGeocodingAddress } from "./geocoding.js";

test("campus addresses are formatted for geocoding", () => {
  assert.equal(
    formatGeocodingAddress({
      addressLine1: "123 Main Street",
      addressLine2: null,
      city: "Springfield",
      region: "IL",
      postalCode: "62701",
      countryCode: "US"
    }),
    "123 Main Street, Springfield, IL, 62701, US"
  );
});
