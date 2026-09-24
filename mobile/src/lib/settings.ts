import { getSetting, setSetting } from "../db";
import type { ShopProfile } from "./types";

export const DEFAULT_SHOP_NAME = "M.L Traders";

const KEYS = {
  name: "shop_name",
  address: "shop_address",
  phone: "shop_phone",
  gstin: "shop_gstin",
} as const;

export async function getShopName(): Promise<string> {
  return (await getSetting(KEYS.name)) || DEFAULT_SHOP_NAME;
}

/** Everything that goes in a challan's letterhead. Blank fields are simply
 *  left off the printed document rather than printed empty. */
export async function getShopProfile(): Promise<ShopProfile> {
  const [name, address, phone, gstin] = await Promise.all([
    getShopName(),
    getSetting(KEYS.address),
    getSetting(KEYS.phone),
    getSetting(KEYS.gstin),
  ]);
  return {
    name,
    address: address ?? "",
    phone: phone ?? "",
    gstin: gstin ?? "",
  };
}

export async function saveShopProfile(profile: ShopProfile): Promise<void> {
  await setSetting(KEYS.name, profile.name.trim() || DEFAULT_SHOP_NAME);
  await setSetting(KEYS.address, profile.address.trim());
  await setSetting(KEYS.phone, profile.phone.trim());
  await setSetting(KEYS.gstin, profile.gstin.trim().toUpperCase());
}
