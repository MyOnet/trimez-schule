import { ipHash } from "./krypto.mjs";
export const protokolliere = (q, req, aktion, objekt_typ, objekt_id, vorher = null, nachher = null, grund = null) =>
  q("INSERT INTO protokoll (person_id, aktion, objekt_typ, objekt_id, vorher, nachher, grund, ip_hash) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
    [req.ctx ? req.ctx.personId : null, aktion, objekt_typ, objekt_id ? String(objekt_id) : null, vorher, nachher, grund, ipHash(req.ip)]);
