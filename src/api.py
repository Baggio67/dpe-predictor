import os
import pickle
import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

app = FastAPI(
    title="DPE Predictor API",
    description="API de prédiction de classe DPE (Régression Logistique Multinomiale)",
    version="1.0.0"
)

# Configuration CORS pour autoriser l'accès depuis le frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Chargement du modèle et du scaler au démarrage
MODEL_PATH = os.path.join("data", "model.pkl")
SCALER_PATH = os.path.join("data", "scaler.pkl")

model = None
scaler = None

if os.path.exists(MODEL_PATH) and os.path.exists(SCALER_PATH):
    try:
        with open(MODEL_PATH, "rb") as f:
            model = pickle.load(f)
        with open(SCALER_PATH, "rb") as f:
            scaler = pickle.load(f)
        print("Modèle et Scaler chargés avec succès pour l'API.")
    except Exception as e:
        print(f"Erreur lors du chargement des fichiers pickle : {e}")
else:
    print("ATTENTION : model.pkl ou scaler.pkl absent du dossier data/.")

# Schéma de validation Pydantic pour la requête
class DiagnosticInput(BaseModel):
    surface: float = Field(..., ge=20.0, le=300.0, description="Surface habitable en m²")
    pieces: int = Field(..., ge=1, le=10, description="Nombre de pièces")
    age: float = Field(..., ge=0.0, le=150.0, description="Âge du bâtiment en années")
    occupants: int = Field(..., ge=1, le=8, description="Nombre d'occupants")
    annual_consumption: float = Field(..., ge=100.0, description="Consommation annuelle en kWh")
    heating_type: str = Field(..., description="Type de chauffage (Electrique, Gaz, Fioul, Bois, Pompe_a_chaleur)")
    insulation: str = Field(..., description="Qualité d'isolation (Mauvaise, Moyenne, Bonne, Excellente)")

@app.get("/")
@app.get("/health")
def health_check():
    if model is None or scaler is None:
        return {"status": "unhealthy", "message": "Fichiers modèle ou scaler manquants"}
    return {"status": "healthy", "model_classes": list(model.classes_)}

@app.post("/predict")
def predict(data: DiagnosticInput):
    global model, scaler
    
    # Recharger dynamiquement si non chargé au démarrage
    if model is None or scaler is None:
        if os.path.exists(MODEL_PATH) and os.path.exists(SCALER_PATH):
            with open(MODEL_PATH, "rb") as f:
                model = pickle.load(f)
            with open(SCALER_PATH, "rb") as f:
                scaler = pickle.load(f)
        else:
            raise HTTPException(status_code=503, detail="Modèle non disponible sur le serveur.")

    # Listes de référence pour l'encodage One-Hot
    heating_categories = ['Electrique', 'Gaz', 'Fioul', 'Bois', 'Pompe_a_chaleur']
    insulation_categories = ['Mauvaise', 'Moyenne', 'Bonne', 'Excellente']

    # Validation des entrées catégorielles
    if data.heating_type not in heating_categories:
        raise HTTPException(
            status_code=400, 
            detail=f"Type de chauffage invalide. Valeurs acceptées : {heating_categories}"
        )
    if data.insulation not in insulation_categories:
        raise HTTPException(
            status_code=400, 
            detail=f"Qualité d'isolation invalide. Valeurs acceptées : {insulation_categories}"
        )

    # 1. Encodage One-Hot manuel
    heating_encoded = {f'heating_type_{cat}': 1.0 if data.heating_type == cat else 0.0 for cat in heating_categories}
    insulation_encoded = {f'insulation_{cat}': 1.0 if data.insulation == cat else 0.0 for cat in insulation_categories}

    # 2. Construction du vecteur de features avec le même ordre que train_model.py
    feature_dict = {
        'surface': data.surface,
        'pieces': data.pieces,
        'age': data.age,
        'occupants': data.occupants,
        'annual_consumption': data.annual_consumption,
        **heating_encoded,
        **insulation_encoded
    }

    feature_cols = [
        'surface', 'pieces', 'age', 'occupants', 'annual_consumption',
        'heating_type_Electrique', 'heating_type_Gaz', 'heating_type_Fioul', 
        'heating_type_Bois', 'heating_type_Pompe_a_chaleur',
        'insulation_Mauvaise', 'insulation_Moyenne', 'insulation_Bonne', 'insulation_Excellente'
    ]

    raw_vector = [feature_dict[col] for col in feature_cols]
    
    # 3. Standardisation
    # Convertir en DataFrame pour conserver les métadonnées de feature names si nécessaire
    X_df = pd.DataFrame([raw_vector], columns=feature_cols)
    X_scaled = scaler.transform(X_df)

    # 4. Prédiction
    pred_class = model.predict(X_scaled)[0]
    probabilities = model.predict_proba(X_scaled)[0]
    
    # Formater les probabilités sous forme de dictionnaire {Classe: Probabilité}
    prob_dict = {model.classes_[i]: float(probabilities[i]) for i in range(len(model.classes_))}
    confidence = float(np.max(probabilities))

    return {
        "predicted_class": pred_class,
        "confidence": confidence,
        "probabilities": prob_dict,
        "specific_consumption": data.annual_consumption / data.surface
    }
