import { useEffect, useState } from "react";
import { GoogleGenAI } from "@google/genai";


const model = "gemini-3-flash-preview";

const ai = new GoogleGenAI({
  vertexai: true,
  apiKey: import.meta.env.VITE_API_KEY
});

export function GenAI() {

  const fieldMap = {
    "owner_name": "ten",
    "registration_document_address_line": "dchi",
    "registration_brand_ຍີ່ຫໍ້": "hang_xe",
    "registration_model_ລຸ້ນ": "hieu_xe",
    "insurance_manufactured_year": "nam_sx",
    "registration_date_of_issue": "ngay_sx",
    "license_plate": "bien_xe",
    "registration_engine_number": "so_may",
    "registration_chassis_number": "so_khung",
    "insurance_seats_ຈຳນວນບ່ອນນັ່ງ": "so_cn",
    "insurance_market_value": "gia_xe",
    "insurance_sum_insured_ມູນຄ່າລົດຕາມທ້ອງຕະຫຼາດ": "tv_tien",
    "insurance_issue_date": "ngay_cap",
    "insurance_inception_date": "ngay_hl",
    "insurance_expiry_date": "ngay_kt",
    "insurance_package_checkbox_ປະກັນໄພແພັກເກັດ": "so_lpx",
    "third_party_liability-coverage-limit-amount": "bn_tien",
    "third_party_liability-net-premium-amount": "bn_phi",
    "voluntary-third-party-limit-amount": "tn_tien",
    "voluntary-third-party-net-premium-amount": "tn_phi",
    "pa/driver&passenger-limit-amount": "tt_tien",
    "pa/driver&passenger-net-premium-amount": "tt_phi",
    "passenger-legal-liability-limit-amount": "tk_tien",
    "passenger-legal-liability-net-premium-amount": "tk_phi",
    "own-damage-net-premium-amount": "tv_phi"
  };
  
  const [selectedPlate, setSelectedPlate] = useState(null);
  const [plateGroups, setPlateGroups] = useState({});
  const [results, setResults] = useState({});
  const [running, setRunning] = useState(false);
  const [images, setImages] = useState([]);
  
  function updateField(plate, field, value) {
    setResults(prev => ({
      ...prev,
      [plate]: {
        ...prev[plate],
        [field]: value
      }
    }));
  }

  function renameFields(data) {

    const renamed = {};

    for (const [key, value] of Object.entries(data)) {

      const newKey = fieldMap[key] || key;

      renamed[newKey] = value;
    }

    return renamed;
  }

  function handleUpload(event) {
    const files = Array.from(event.target.files);

    const formatted = files.map((file) => ({
      name: file.name,
      file: file
    }));
  
    setImages(formatted);
  }
  
  async function fileToBase64(file) {
    return new Promise((resolve) => {
      const reader = new FileReader();

      reader.onloadend = () => {
        const base64 = reader.result.split(",")[1];
        resolve(base64);
      };

      reader.readAsDataURL(file);
    });
  }

  async function safeGenerate(contents, retries = 15) {

    let delay = 1000;

    for (let attempt = 0; attempt < retries; attempt++) {

      try {

        const response = await ai.models.generateContent({
          model,
          contents,
          config: {
            temperature: 0,
            responseMimeType: "application/json"
          }
        });

        return response;

      } catch (e) {

        const status = e?.status || e?.error?.status || "";
        const message = e?.message || "";

        const isRateLimit =
          status === "RESOURCE_EXHAUSTED" ||
          message.includes("429") ||
          message.includes("Resource exhausted");

        if (isRateLimit) {

          console.log(`Rate limit hit. Retrying in ${delay/1000}s...`);

          await new Promise(r => setTimeout(r, delay));

          delay = Math.min(delay * 2, 32000);

          continue;
        }

        throw e;
      }
    }

    throw new Error("Max retries exceeded");
  }

  async function preprocess() {

    const contents = [
  `You are analyzing multiple images.

  Task:
  Detect ALL vehicle license plates visible in each image.

  Rules:
  - Extract plates exactly as written
  - Do NOT translate
  - If no plate return empty list

  Return JSON mapping filename -> plates`
    ];

    for (const img of images) {

      const base64 = await fileToBase64(img.file);

      contents.push(`Filename: ${img.name}`);

      contents.push({
        inlineData: {
          data: base64,
          mimeType: img.file.type
        }
      });
    }

    const response = await safeGenerate(contents);

    const assignment = JSON.parse(response.text);

    console.log("License mapping:", assignment);

    return assignment;
  }

  function groupImagesByPlate(licenseDict) {

    const groups = {};

    for (const [image, plates] of Object.entries(licenseDict)) {

      for (const plate of plates) {

        if (!groups[plate]) {
          groups[plate] = [];
        }

        groups[plate].push(image);
      }
    }

    return groups;
  }

  async function pipelineOnePrompt(plate, imageList) {

    const contents = [
      `You are an information extraction system.

      Target vehicle license plate: ${plate}

      You are given one or more vehicle insurance documents as images.

      Task:
      Carefully extract the following fields exactly as they appear in the documents.

      Fields:
      - owner_name
      - registration_document_address_line
      - registration_brand_ຍີ່ຫໍ້
      - registration_model_ລຸ້ນ
      - insurance_manufactured_year
      - registration_date_of_issue
      - license_plate
      - registration_engine_number
      - registration_chassis_number
      - insurance_seats_ຈຳນວນບ່ອນນັ່ງ
      - insurance_market_value
      - insurance_sum_insured_ມູນຄ່າລົດຕາມທ້ອງຕະຫຼາດ
      - insurance_issue_date
      - insurance_inception_date
      - insurance_expiry_date
      - insurance_package_checkbox_ປະກັນໄພແພັກເກັດ
      - third_party_liability-coverage-limit-amount
      - third_party_liability-net-premium-amount
      - voluntary-third-party-limit-amount
      - voluntary-third-party-net-premium-amount
      - pa/driver&passenger-limit-amount
      - pa/driver&passenger-net-premium-amount
      - passenger-legal-liability-limit-amount
      - passenger-legal-liability-net-premium-amount
      - own-damage-net-premium-amount

      Rules:
      - Extract text exactly as written.
      - Do NOT translate any language.
      - Do NOT infer missing information.
      - If a field is not present, return null.
      - Do NOT hallucinate values.
      - Preserve numbers, punctuation, and spelling exactly.
      - The returned license_plate MUST equal "${plate}"

      Output format:
      Return exactly ONE JSON object.
      Never return an array.
      Merge information from all images into the same object.
      Nummerical amount values should be stripped of decimals and currency symbols
      No explanations.

      Example structure:

      {
      "owner_name": null,
      "registration_document_address_line": null,
      "registration_brand_ຍີ່ຫໍ້": null,
      "registration_model_ລຸ້ນ": null,
      "insurance_manufactured_year": null,
      "registration_date_of_issue": null,
      "license_plate": null,
      "registration_engine_number": null,
      "registration_chassis_number": null,
      "insurance_seats_ຈຳນວນບ່ອນນັ່ງ": null,
      "insurance_market_value": null,
      "insurance_sum_insured_ມູນຄ່າລົດຕາມທ້ອງຕະຫຼາດ": null,
      "insurance_issue_date": null,
      "insurance_inception_date": null,
      "insurance_expiry_date": null,
      "insurance_package_checkbox_ປະກັນໄພແພັກເກັດ": null,
      "third_party_liability-coverage-limit-amount": null,
      "third_party_liability-net-premium-amount": null,
      "voluntary-third-party-limit-amount": null,
      "voluntary-third-party-net-premium-amount": null,
      "pa/driver&passenger-limit-amount": null,
      "pa/driver&passenger-net-premium-amount": null,
      "passenger-legal-liability-limit-amount": null,
      "passenger-legal-liability-net-premium-amount": null,
      "own-damage-net-premium-amount": null
      }

      
      `
    ];

    for (const file of imageList) {

      const img = images.find(i => i.name === file);

      const base64 = await fileToBase64(img.file);

      contents.push({
        inlineData: {
          data: base64,
          mimeType: img.file.type
        }
      });
    }

    const response = await safeGenerate(contents);

    return JSON.parse(response.text);
  }

  async function main() {

    if (running) return; // prevent double click
   
    if (!images.length) {
      alert("Upload images first");
      return;
    }

    setRunning(true);

    try {

      const licenseDict = await preprocess();

      const groups = groupImagesByPlate(licenseDict);

      setPlateGroups(groups);

      console.log("grouped plates:");
      console.log(plateGroups);


      for (const [plate, imgs] of Object.entries(groups)) {

        console.log("Processing:", plate);

        const raw = await pipelineOnePrompt(plate, imgs);

        const result = renameFields(raw);

        console.log(result);

        setResults(prev => ({
          ...prev,
          [plate]: result
        }));

      }

      console.log("Final results:");
      console.log(results);

    } catch (err) {
      console.error(err);
    } finally {
      setRunning(false); // unlock button
    }
  }

  return (
    <div className="container">

      <div className="left-panel">

        <p>Upload Vehicle Documents</p>

        <input
          type="file"
          multiple
          accept="image/*"
          onChange={handleUpload}
        />

        <br /><br />

        <button onClick={main} disabled={running}>
          {running ? "Processing..." : "Run Extraction"}
        </button>

        <div className="image-groups">

          {Object.entries(plateGroups).map(([plate, imgs]) => (

            <div
              key={plate}
              className={`plate-group ${selectedPlate === plate ? "active" : ""}`}
              onClick={() => setSelectedPlate(plate)}
            >
              <p className="plate-title">{plate}</p>

              <div className="image-list">

                {imgs.map((imgName) => {

                  const imgObj = images.find(i => i.name === imgName);

                  if (!imgObj) return null;

                  const url = URL.createObjectURL(imgObj.file);

                  return (
                    <img
                      key={imgName}
                      src={url}
                      alt={imgName}
                      className="plate-image"
                    />
                  );
                })}

              </div>

            </div>

          ))}

        </div>

      </div>

      <div className="main-panel">

        <p>Extracted Information:</p>

        {Object.entries(results)
        .filter(([plate]) => !selectedPlate || plate === selectedPlate)
        .map(([plate, data]) => (

          <div key={plate} className="result-box">

            <h3>{plate}</h3>

            <div className="fields-grid">

              {Object.entries(data).map(([field, value]) => (

                <div key={field} className="field-row">

                  <label>{field}</label>

                  <input
                    type="text"
                    value={value ?? ""}
                    onChange={(e) =>
                      updateField(plate, field, e.target.value)
                    }
                  />

                </div>

              ))}

            </div>

          </div>

        ))}

      </div>

    </div>
  );
}