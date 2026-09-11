import { parseOfacSdn } from '../../../src/modules/screening/infrastructure/adapters/outbound/sanctions/ofacSdnParser.js';
import { parseEuFsf } from '../../../src/modules/screening/infrastructure/adapters/outbound/sanctions/euFsfParser.js';
import { parseUkFcdo } from '../../../src/modules/screening/infrastructure/adapters/outbound/sanctions/ukFcdoParser.js';

/*
 * Fixtures are cut from the real publications downloaded on 2026-09-11
 * (OFAC SDN.XML of 09/10/2026, EU FSF export 184961, UK Sanctions List of
 * 10/09/2026), trimmed to the elements the parsers read plus the noise
 * they must ignore. Structure and tag names are as published.
 */

/** Tiny chunks on purpose: tags, attributes and text all get split across chunk boundaries. */
async function* chunked(xml: string, size = 7): AsyncGenerator<string> {
  for (let start = 0; start < xml.length; start += size) yield xml.slice(start, start + size);
}

const OFAC_XML = `<?xml version="1.0" standalone="yes"?>
<sdnList xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns="https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/XML">
  <publshInformation><Publish_Date>09/10/2026</Publish_Date><Record_Count>3</Record_Count></publshInformation>
  <sdnEntry>
    <uid>4632</uid>
    <lastName>BANK MARKAZI JOMHOURI ISLAMI IRAN</lastName>
    <sdnType>Entity</sdnType>
    <remarks>(Linked To: HIZBALLAH)</remarks>
    <programList><program>IRAN</program><program>SDGT</program></programList>
    <idList>
      <id><uid>185825</uid><idType>Secondary sanctions risk:</idType><idNumber>section 1(b) of Executive Order 13224</idNumber></id>
      <id><uid>130012</uid><idType>Additional Sanctions Information -</idType><idNumber>Subject to Secondary Sanctions</idNumber></id>
      <id><uid>197667</uid><idType>Digital Currency Address - TRX</idType><idNumber>TNiq9AXBp9EjUqhDhrwrfvAA8U3GUQZH81</idNumber></id>
      <id><uid>197668</uid><idType>Digital Currency Address - TRX</idType><idNumber>TTiDLWE6fZK8okMJv6ijg42yrH6W2pjSr9</idNumber></id>
    </idList>
    <akaList>
      <aka><uid>3553</uid><type>a.k.a.</type><category>strong</category><lastName>CENTRAL BANK OF THE ISLAMIC REPUBLIC OF IRAN</lastName></aka>
      <aka><uid>9001</uid><type>a.k.a.</type><category>weak</category><lastName>MARKAZI</lastName></aka>
    </akaList>
    <addressList><address><uid>2898</uid><city>Tehran</city><country>Iran</country></address></addressList>
  </sdnEntry>
  <sdnEntry>
    <uid>7001</uid>
    <firstName>Juan Carlos</firstName>
    <lastName>PÉREZ GÓMEZ</lastName>
    <sdnType>Individual</sdnType>
    <idList>
      <id><uid>1</uid><idType>Gender</idType><idNumber>Male</idNumber></id>
      <id><uid>2</uid><idType>Passport</idType><idNumber>AB123456</idNumber><idCountry>Colombia</idCountry></id>
      <id><uid>3</uid><idType>Cedula No.</idType><idNumber>79123456</idNumber></id>
    </idList>
    <addressList><address><uid>5</uid><country>Venezuela</country></address></addressList>
    <nationalityList><nationality><uid>6</uid><country>Colombia</country><mainEntry>true</mainEntry></nationality></nationalityList>
  </sdnEntry>
  <sdnEntry><uid>8001</uid><lastName>OCEAN STAR</lastName><sdnType>Vessel</sdnType></sdnEntry>
</sdnList>`;

const EU_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<export xmlns="http://eu.europa.ec/fpi/fsd/export" generationDate="2026-08-05T16:47:04.449+02:00" globalFileId="184961">
  <sanctionEntity designationDetails="" unitedNationId="" euReferenceNumber="EU.77.33" logicalId="83">
    <remark>UNSC RESOLUTION 1483 BASIS</remark>
    <subjectType code="person" classificationCode="P"/>
    <nameAlias firstName="Tarek" middleName="Mikhail" lastName="Aziz" wholeName="Tarek Mikhail Aziz" strong="true" logicalId="1388">
      <regulationSummary regulationType="regulation" publicationDate="2003-07-08" numberTitle="1210/2003 (OJ L169)"/>
    </nameAlias>
    <nameAlias wholeName="Tariq Aziz" strong="true" logicalId="124"/>
    <nameAlias wholeName="T. Aziz" strong="false" logicalId="125"/>
    <citizenship region="" countryIso2Code="IQ" countryDescription="IRAQ" logicalId="30"/>
    <identification number="34409/129" identificationTypeCode="other" countryIso2Code="00" logicalId="1"/>
    <identification number="A1234567" identificationTypeCode="passport" countryIso2Code="IQ" logicalId="2"/>
  </sanctionEntity>
  <sanctionEntity designationDate="2002-06-18" euReferenceNumber="EU.3502.46" logicalId="201">
    <subjectType code="enterprise" classificationCode="E"/>
    <nameAlias wholeName="Organização Abu Nidal" nameLanguage="PT" strong="true" logicalId="123121"/>
    <address countryIso2Code="00" countryDescription="UNKNOWN" logicalId="9"/>
    <address countryIso2Code="LB" countryDescription="LEBANON" logicalId="10"/>
  </sanctionEntity>
</export>`;

const UK_XML = `<?xml version="1.0" encoding="utf-8"?>
<Designations xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <DateGenerated>10/09/2026</DateGenerated>
  <Designation>
    <UniqueID>AFG0006</UniqueID>
    <Names>
      <Name><Name6>AKHUND</Name6><NameType>Alias</NameType><AliasStrength>Good quality a.k.a</AliasStrength></Name>
      <Name><Name1>MOHAMMAD</Name1><Name2>HASSAN</Name2><Name6>AKHUND</Name6><NameType>Primary Name</NameType></Name>
      <Name><Name1>MULLAH</Name1><Name6>MOHAMMAD</Name6><NameType>ALias</NameType><AliasStrength>Low quality a.k.a</AliasStrength></Name>
    </Names>
    <IndividualEntityShip>Individual</IndividualEntityShip>
    <Addresses><Address><AddressLine6>Kabul</AddressLine6><AddressCountry>Afghanistan</AddressCountry></Address></Addresses>
    <IndividualDetails><Individual>
      <Nationalities><Nationality>Pakistan</Nationality></Nationalities>
      <PassportDetails>
        <Passport><PassportNumber>P04581926</PassportNumber></Passport>
        <Passport><PassportNumber>P04581926</PassportNumber></Passport>
      </PassportDetails>
      <NationalIdentifierDetails><NationalIdentifier><NationalIdentifierNumber>2132370</NationalIdentifierNumber></NationalIdentifier></NationalIdentifierDetails>
    </Individual></IndividualDetails>
  </Designation>
  <Designation>
    <UniqueID>RUS1234</UniqueID>
    <Names><Name><Name6>STROYGAZ LLC</Name6><NameType>Primary name</NameType></Name></Names>
    <IndividualEntityShip>Entity</IndividualEntityShip>
    <EntityDetails><Entity><BusinessRegistrationNumbers>
      <BusinessRegistrationNumber>1027700132195</BusinessRegistrationNumber>
      <BusinessRegistrationNumber>(УНН/ИНН): 190950894 (Belarus), 7704734000/770301001 (Russia)</BusinessRegistrationNumber>
    </BusinessRegistrationNumbers></Entity></EntityDetails>
  </Designation>
  <Designation><UniqueID>RUS9999</UniqueID><Names><Name><Name6>SEA GLORY</Name6><NameType>Primary Name</NameType></Name></Names><IndividualEntityShip>Ship</IndividualEntityShip></Designation>
</Designations>`;

describe('parseOfacSdn', () => {
  it('reads every sdnEntry, keeping identifiers and wallets and dropping metadata ids and weak a.k.a.s', async () => {
    const parties = await parseOfacSdn(chunked(OFAC_XML));

    expect(parties).toEqual([
      {
        uid: '4632',
        entryType: 'ORGANIZATION',
        names: ['BANK MARKAZI JOMHOURI ISLAMI IRAN', 'CENTRAL BANK OF THE ISLAMIC REPUBLIC OF IRAN'],
        documents: [],
        walletAddresses: ['TNiq9AXBp9EjUqhDhrwrfvAA8U3GUQZH81', 'TTiDLWE6fZK8okMJv6ijg42yrH6W2pjSr9'],
        country: 'Iran',
      },
      {
        uid: '7001',
        entryType: 'PERSON',
        names: ['Juan Carlos PÉREZ GÓMEZ'],
        // "Gender: Male" is an idList entry too; it must never become a document.
        documents: ['AB123456', '79123456'],
        walletAddresses: [],
        // Nationality wins over the address: for a person it is the meaningful country.
        country: 'Colombia',
      },
      { uid: '8001', entryType: 'ORGANIZATION', names: ['OCEAN STAR'], documents: [], walletAddresses: [], country: null },
    ]);
  });

  it('gives the same result however the download is chunked', async () => {
    const whole = await parseOfacSdn(chunked(OFAC_XML, OFAC_XML.length));
    expect(await parseOfacSdn(chunked(OFAC_XML, 1))).toEqual(whole);
  });

  it('rejects a document that is not well-formed instead of returning a partial list', async () => {
    await expect(parseOfacSdn(chunked('<sdnList><sdnEntry><uid>1</uid></sdnList>'))).rejects.toThrow();
  });

  it('returns nothing for an HTML page served in place of the list', async () => {
    await expect(parseOfacSdn(chunked('<html><body><p>Maintenance</p></body></html>'))).resolves.toEqual([]);
  });
});

describe('parseEuFsf', () => {
  it('reads sanctionEntity attributes, keeping strong aliases and identity documents only', async () => {
    const parties = await parseEuFsf(chunked(EU_XML));

    expect(parties).toEqual([
      {
        uid: '83',
        entryType: 'PERSON',
        names: ['Tarek Mikhail Aziz', 'Tariq Aziz'],
        documents: ['A1234567'],
        walletAddresses: [],
        country: 'IQ',
      },
      {
        uid: '201',
        entryType: 'ORGANIZATION',
        names: ['Organização Abu Nidal'],
        documents: [],
        walletAddresses: [],
        // "00" is the list's code for unknown; the next known country is used.
        country: 'LB',
      },
    ]);
  });
});

describe('parseUkFcdo', () => {
  it('reads each Designation with the primary name first and low quality a.k.a.s dropped', async () => {
    const [individual, entity, ship] = await parseUkFcdo(chunked(UK_XML));

    expect(individual).toEqual({
      uid: 'AFG0006',
      entryType: 'PERSON',
      names: ['MOHAMMAD HASSAN AKHUND', 'AKHUND'],
      documents: ['P04581926', '2132370'],
      walletAddresses: [],
      country: 'Pakistan',
    });
    // The prose registration number cannot match anything exactly, so it is not kept.
    expect(entity).toEqual(expect.objectContaining({ entryType: 'ORGANIZATION', documents: ['1027700132195'] }));
    expect(ship).toEqual(expect.objectContaining({ uid: 'RUS9999', entryType: 'ORGANIZATION', names: ['SEA GLORY'] }));
  });
});
