export const STAGE1_ODS_WEBSITE_TARGETS = [
  {
    organisationName: "Manchester University NHS Foundation Trust",
    odsCode: "R0A",
    website: "https://mft.nhs.uk/",
  },
  {
    organisationName: "Leeds Teaching Hospitals NHS Trust",
    odsCode: "RR8",
    website: "https://www.leedsth.nhs.uk/",
  },
  {
    organisationName: "Liverpool University Hospitals NHS Foundation Trust",
    odsCode: "REM",
    website: "https://www.rlbuht.nhs.uk/",
  },
  {
    organisationName: "Cambridge University Hospitals NHS Foundation Trust",
    odsCode: "RGT",
    website: "https://www.cuh.nhs.uk/",
  },
  {
    organisationName: "Imperial College Healthcare NHS Trust",
    odsCode: "RYJ",
    website: "https://www.imperial.nhs.uk/",
  },
  {
    organisationName: "Nottingham University Hospitals NHS Trust",
    odsCode: "RX1",
    website: "https://www.nuh.nhs.uk/",
  },
  {
    organisationName: "University Hospitals of Leicester NHS Trust",
    odsCode: "RWE",
    website: "https://www.leicestershospitals.nhs.uk/",
  },
  {
    organisationName: "Royal Free London NHS Foundation Trust",
    odsCode: "RAL",
    website: "https://www.royalfree.nhs.uk/",
  },
  {
    organisationName: "UNIVERSITY HOSPITALS COVENTRY AND WARWICKSHIRE NHS TRUST",
    odsCode: "RKB",
    website: "https://www.uhcw.nhs.uk/",
  },
  {
    organisationName: "East Kent Hospitals University NHS Foundation Trust",
    odsCode: "RVV",
    website: "https://www.ekhuft.nhs.uk/patients-and-visitors/",
  },
  {
    organisationName: "Royal Devon University Healthcare NHS Foundation Trust",
    odsCode: "RH8",
    website: "https://royaldevon.nhs.uk/",
  },
  {
    organisationName: "Blackpool Teaching Hospitals NHS Foundation Trust",
    odsCode: "RXL",
    website: "https://www.bfwh.nhs.uk/",
  },
  {
    organisationName: "Birmingham Women's and Children's NHS Foundation Trust",
    odsCode: "RQ3",
    website: "https://bwc.nhs.uk/",
  },
  {
    organisationName: "Central and North West London NHS Foundation Trust",
    odsCode: "RV3",
    website: "https://www.cnwl.nhs.uk/",
  },
  {
    organisationName: "Bradford Teaching Hospitals NHS Foundation Trust",
    odsCode: "RAE",
    website: "https://www.bradfordhospitals.nhs.uk/",
  },
  {
    organisationName: "Barnsley Hospital NHS Foundation Trust",
    odsCode: "RFF",
    website: "https://www.barnsleyhospital.nhs.uk/",
  },
  {
    organisationName: "North West Anglia NHS Foundation Trust",
    odsCode: "RGN",
    website: "https://www.nwangliaft.nhs.uk/",
  },
  {
    organisationName: "Chesterfield Royal Hospital NHS Foundation Trust",
    odsCode: "RFS",
    website: "https://www.chesterfieldroyal.nhs.uk/",
  },
] as const;

export type Stage1OdsWebsiteRow = {
  organisation_name: string;
  website: string | null;
  website_ods_code: string | null;
  website_ods_record_url: string | null;
};

export type Stage1OdsWebsiteUpdate = {
  organisationName: string;
  odsCode: string;
  website: string;
  odsRecordUrl: string;
};

function normalizedName(value: string): string {
  return value.trim().toLocaleLowerCase("en-GB");
}

export function stage1OdsRecordUrl(odsCode: string): string {
  return `https://directory.spineservices.nhs.uk/ORD/2-0-0/organisations/${encodeURIComponent(odsCode)}`;
}

export function planStage1OdsWebsiteUpdates(
  rows: readonly Stage1OdsWebsiteRow[],
): Stage1OdsWebsiteUpdate[] {
  const targetsByName = new Map(
    STAGE1_ODS_WEBSITE_TARGETS.map((target) => [
      normalizedName(target.organisationName),
      target,
    ]),
  );
  const rowsByName = new Map<string, Stage1OdsWebsiteRow[]>();

  for (const row of rows) {
    const key = normalizedName(row.organisation_name);
    if (!targetsByName.has(key)) {
      throw new Error("Production selection returned an employer outside the approved Stage 1 list.");
    }
    const matches = rowsByName.get(key) ?? [];
    matches.push(row);
    rowsByName.set(key, matches);
  }

  return STAGE1_ODS_WEBSITE_TARGETS.map((target) => {
    const matches = rowsByName.get(normalizedName(target.organisationName)) ?? [];
    if (matches.length !== 1) {
      throw new Error(
        `Expected exactly one production sponsor row for ${target.organisationName}; found ${matches.length}.`,
      );
    }
    const row = matches[0]!;
    if (row.website?.trim()) {
      throw new Error(`Refusing to overwrite a nonblank website for ${target.organisationName}.`);
    }
    if (row.website_ods_code?.trim() || row.website_ods_record_url?.trim()) {
      throw new Error(`Refusing to overwrite existing website evidence for ${target.organisationName}.`);
    }
    return {
      organisationName: target.organisationName,
      odsCode: target.odsCode,
      website: target.website,
      odsRecordUrl: stage1OdsRecordUrl(target.odsCode),
    };
  });
}
