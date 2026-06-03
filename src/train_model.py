import os
import json
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import seaborn as sns
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import classification_report, confusion_matrix, accuracy_score

def train_and_export():
    # 1. Load data
    data_path = 'data/building_energy_data.csv'
    if not os.path.exists(data_path):
        raise FileNotFoundError(f"Le fichier de données n'existe pas : {data_path}. Lancez d'abord generate_data.py.")
        
    df = pd.read_csv(data_path)
    print("Données chargées avec succès.")
    
    # 2. Preprocess Categorical Variables (One-Hot Encoding)
    # Define exact category lists to ensure consistency
    heating_categories = ['Electrique', 'Gaz', 'Fioul', 'Bois', 'Pompe_a_chaleur']
    insulation_categories = ['Mauvaise', 'Moyenne', 'Bonne', 'Excellente']
    
    # Create one-hot columns manually to ensure exact column ordering
    for hc in heating_categories:
        df[f'heating_type_{hc}'] = (df['heating_type'] == hc).astype(float)
        
    for ic in insulation_categories:
        df[f'insulation_{ic}'] = (df['insulation'] == ic).astype(float)
        
    # Feature columns list
    feature_cols = [
        'surface', 'pieces', 'age', 'occupants', 'annual_consumption',
        'heating_type_Electrique', 'heating_type_Gaz', 'heating_type_Fioul', 
        'heating_type_Bois', 'heating_type_Pompe_a_chaleur',
        'insulation_Mauvaise', 'insulation_Moyenne', 'insulation_Bonne', 'insulation_Excellente'
    ]
    
    X = df[feature_cols]
    y = df['energy_class']
    
    # Train-test split (80/20)
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42, stratify=y)
    
    # 3. Standardize Features
    # Note: We scale all features to help Logistic Regression converge and regularize.
    scaler = StandardScaler()
    X_train_scaled = scaler.fit_transform(X_train)
    X_test_scaled = scaler.transform(X_test)
    
    # 4. Train Multinomial Logistic Regression
    # We use 'lbfgs' which supports multinomial classification
    model = LogisticRegression(solver='lbfgs', max_iter=1000, random_state=42)
    model.fit(X_train_scaled, y_train)
    
    # 5. Evaluate Model
    y_pred = model.predict(X_test_scaled)
    accuracy = accuracy_score(y_test, y_pred)
    print(f"\nPrécision (Accuracy) du modèle : {accuracy:.4f}")
    
    print("\nRapport de classification :")
    print(classification_report(y_test, y_pred))
    
    # Confusion Matrix
    cm = confusion_matrix(y_test, y_pred, labels=model.classes_)
    
    # Plot and save confusion matrix
    os.makedirs('web/assets', exist_ok=True)
    plt.figure(figsize=(8, 6))
    sns.heatmap(cm, annot=True, fmt='d', cmap='Blues', xticklabels=model.classes_, yticklabels=model.classes_)
    plt.title('Matrice de Confusion - Régression Logistique Multinomiale')
    plt.ylabel('Classe Réelle')
    plt.xlabel('Classe Prédite')
    plt.tight_layout()
    plt.savefig('web/assets/confusion_matrix.png', dpi=300)
    plt.close()
    print("Matrice de confusion sauvegardée sous 'web/assets/confusion_matrix.png'")
    
    # Plot feature importance for each class
    # For logistic regression, the coefficients represent the log-odds impact
    plt.figure(figsize=(12, 10))
    classes = model.classes_
    for i, class_name in enumerate(classes):
        plt.subplot(4, 2, i+1)
        # Sort coefficients
        coefs = model.coef_[i]
        sorted_idx = np.argsort(coefs)
        plt.barh(np.array(feature_cols)[sorted_idx], coefs[sorted_idx], color='teal')
        plt.title(f'Coefficients pour la Classe {class_name}')
        plt.axvline(x=0, color='black', linestyle='--', linewidth=0.8)
    plt.tight_layout()
    plt.savefig('web/assets/coefficients.png', dpi=300)
    plt.close()
    print("Graphique des coefficients sauvegardé sous 'web/assets/coefficients.png'")
    
    # 6. Export Parameters to JS (web/model_coefficients.js)
    # Save mean, scale, coef, intercept, feature names, class names
    model_params = {
        'features': feature_cols,
        'classes': list(model.classes_),
        'means': list(scaler.mean_),
        'stds': list(scaler.scale_),
        'coefs': [list(c) for c in model.coef_],
        'intercepts': list(model.intercept_),
        'accuracy': float(accuracy)
    }
    
    js_content = f"// Fichier généré automatiquement - Paramètres du modèle de régression logistique multinomiale\n"
    js_content += f"const MODEL_PARAMS = {json.dumps(model_params, indent=2)};\n"
    
    with open('web/model_coefficients.js', 'w', encoding='utf-8') as f:
        f.write(js_content)
        
    print("Paramètres du modèle exportés vers 'web/model_coefficients.js'")
    
    # 7. Export model and scaler using pickle for Python backend API
    import pickle
    with open('data/model.pkl', 'wb') as f:
        pickle.dump(model, f, protocol=4)
    with open('data/scaler.pkl', 'wb') as f:
        pickle.dump(scaler, f, protocol=4)
    print("Modèle sérialisé sauvegardé dans 'data/model.pkl'")
    print("Scaler sérialisé sauvegardé dans 'data/scaler.pkl'")

if __name__ == '__main__':
    train_and_export()
