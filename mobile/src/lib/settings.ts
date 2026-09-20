import { getSetting, setSetting } from "../db";

export const SHOP_NAME_KEY = "shop_name";
export const DEFAULT_SHOP_NAME = "M.L Traders";

export async function getShopName(): Promise<string> {
  return (await getSetting(SHOP_NAME_KEY)) || DEFAULT_SHOP_NAME;
}

export async function setShopName(name: string): Promise<void> {
  await setSetting(SHOP_NAME_KEY, name.trim() || DEFAULT_SHOP_NAME);
}
