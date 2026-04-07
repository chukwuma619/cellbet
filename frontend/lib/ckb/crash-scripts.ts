import {
  Address,
  CellDep,
  Script,
  type Client,
  type Hex,
  type ScriptLike,
  type Signer,
} from "@ckb-ccc/core";

import type { CrashOnChainConfig } from "./crash-config";

export function scriptHashBytes(script: ScriptLike): Uint8Array {
  return hexToBytes32(Script.from(script).hash());
}

function hexToBytes32(h: Hex): Uint8Array {
  const s = h.startsWith("0x") ? h.slice(2) : h;
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    out[i] = Number.parseInt(s.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export async function getUserLockFromSigner(signer: Signer): Promise<{
  script: Script;
  lockHashBytes: Uint8Array;
}> {
  const addr = await signer.getRecommendedAddressObj();
  const script = addr.script;
  const lockHashBytes = scriptHashBytes(script);
  return { script, lockHashBytes };
}

export async function lockHashesForHouseAndPlatform(
  client: Client,
  cfg: CrashOnChainConfig,
) {
  const house = await Address.fromString(cfg.houseCkbAddress, client);
  const platform = await Address.fromString(cfg.platformCkbAddress, client);
  return {
    houseScript: house.script,
    platformScript: platform.script,
    houseHash: scriptHashBytes(house.script),
    platformHash: scriptHashBytes(platform.script),
  };
}

export function crashRoundTypeScript(cfg: CrashOnChainConfig): Script {
  return Script.from({
    codeHash: cfg.typeScriptCodeHash,
    hashType: cfg.typeScriptHashType,
    args: "0x",
  });
}

export function crashRoundCellDep(cfg: CrashOnChainConfig): CellDep {
  return CellDep.from({
    outPoint: {
      txHash: cfg.cellDep.outTxHash,
      index: cfg.cellDep.outputIndex,
    },
    depType: cfg.cellDep.depType,
  });
}
