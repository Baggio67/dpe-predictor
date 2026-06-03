import os
import numpy as np
import pandas as pd

def generate_building_data(num_samples=1500, random_seed=42):
    np.random.seed(random_seed)
    
    # 1. Surface (m²) - Log-normal distribution to represent typical housing distribution
    # Most houses are between 40 and 150m², with a long tail up to 300m²
    surface = np.random.lognormal(mean=4.4, sigma=0.4, size=num_samples)
    surface = np.clip(surface, 20.0, 300.0)
    
    # 2. Nombre de pièces - Correlated with surface
    # Roughly 1 room per 20-30m², with a minimum of 1 and maximum of 10
    pieces = np.round(surface / np.random.uniform(22.0, 32.0, size=num_samples) + np.random.normal(0, 0.5, size=num_samples))
    pieces = np.clip(pieces, 1, 10).astype(int)
    
    # 3. Âge du bâtiment (années)
    # Mix of old buildings (built before 1948), standard post-war, and modern
    age = np.random.exponential(scale=40.0, size=num_samples)
    age = np.clip(age, 0.0, 150.0)
    
    # 4. Isolation thermique
    # Older buildings tend to have worse insulation unless renovated
    # We define probability weights for isolation level based on the age
    isolation_options = ['Mauvaise', 'Moyenne', 'Bonne', 'Excellente']
    isolation = []
    for a in age:
        if a > 50: # Old buildings
            p = [0.60, 0.30, 0.08, 0.02]
        elif a > 20: # Middle-aged (1975-2005)
            p = [0.20, 0.50, 0.25, 0.05]
        elif a > 5: # Recent (2005-2020)
            p = [0.02, 0.20, 0.60, 0.18]
        else: # Brand new (RT2012 / RE2020)
            p = [0.00, 0.05, 0.45, 0.50]
        isolation.append(np.random.choice(isolation_options, p=p))
    isolation = np.array(isolation)
    
    # 5. Type de chauffage
    # Distributed realistically (Electric, Gas, Wood, Fuel oil, Heat pump)
    # Fuel oil (Fioul) is only in older houses, Heat pump (Pompe à chaleur) in newer ones
    heating_options = ['Electrique', 'Gaz', 'Fioul', 'Bois', 'Pompe_a_chaleur']
    heating = []
    for idx, a in enumerate(age):
        iso = isolation[idx]
        if a > 40: # Old house
            p = [0.25, 0.40, 0.25, 0.08, 0.02]
        elif a > 15:
            p = [0.35, 0.45, 0.08, 0.07, 0.05]
        else: # Recent house (oil boilers banned/highly restricted, heat pumps favored)
            p = [0.30, 0.15, 0.00, 0.15, 0.40]
        heating.append(np.random.choice(heating_options, p=p))
    heating = np.array(heating)
    
    # 6. Nombre d'occupants
    # Correlated with surface and rooms
    occupants = np.round(surface / 50.0 + np.random.uniform(0.5, 2.5, size=num_samples))
    occupants = np.clip(occupants, 1, 8).astype(int)
    
    # 7. Consommation annuelle d'énergie (kWh)
    # Calculated based on physical rules:
    # Heating needs depend on Age (insulation standards of the era) and Isolation level
    base_heat_need = 110.0 # Base kWh/m²/year
    
    # Age factor: older buildings lose more energy
    age_effect = np.zeros(num_samples)
    age_effect[age > 50] = 70.0  # Before 1975
    age_effect[(age <= 50) & (age > 20)] = 25.0 # 1975-2005
    age_effect[(age <= 20) & (age > 5)] = -10.0 # 2005-2020
    age_effect[age <= 5] = -40.0 # After 2020
    
    # Isolation factor: good insulation reduces heat losses
    iso_effect = np.zeros(num_samples)
    iso_effect[isolation == 'Mauvaise'] = 110.0
    iso_effect[isolation == 'Moyenne'] = 40.0
    iso_effect[isolation == 'Bonne'] = -20.0
    iso_effect[isolation == 'Excellente'] = -60.0
    
    # Combined heat need per m²
    heat_need_per_m2 = base_heat_need + age_effect + iso_effect
    # Ensure it's not below 20 (passive house floor)
    heat_need_per_m2 = np.clip(heat_need_per_m2, 20.0, 350.0)
    
    # Heating system efficiency (final energy consumption)
    # Heat pumps divide heating energy need by their Coefficient of Performance (COP ~ 3.2)
    # Electric heating is 100% efficient (final energy), but primary energy is higher. We stick to final energy here.
    # Fuel boilers have lower efficiency.
    heating_factor = np.ones(num_samples)
    heating_factor[heating == 'Pompe_a_chaleur'] = 0.32 # COP of ~3.1
    heating_factor[heating == 'Bois'] = 0.95 # highly efficient wood stove/boiler
    heating_factor[heating == 'Electrique'] = 1.00 # direct heating
    heating_factor[heating == 'Gaz'] = 0.90 # condensing boiler
    heating_factor[heating == 'Fioul'] = 1.15 # older fuel boilers have losses
    
    consommation_chauffage = heat_need_per_m2 * surface * heating_factor
    
    # Domestic Hot Water (ECS) and basic appliances: ~800 kWh per occupant per year
    consommation_ecs_app = occupants * 850.0 + np.random.normal(0, 150, size=num_samples)
    consommation_ecs_app = np.clip(consommation_ecs_app, 300.0, None)
    
    # Total annual consumption
    consommation_annuelle = consommation_chauffage + consommation_ecs_app
    
    # Add random variation (noise from lifestyle, microclimate, etc.)
    noise = np.random.normal(1.0, 0.08, size=num_samples)
    consommation_annuelle = consommation_annuelle * noise
    consommation_annuelle = np.round(consommation_annuelle, 1)
    
    # Calculate specific consumption (kWh/m²/year)
    specific_cons = consommation_annuelle / surface
    
    # 8. Target Variable: Classe énergétique (DPE français)
    # Thresholds:
    # A: <= 70
    # B: 71-110
    # C: 111-180
    # D: 181-250
    # E: 251-330
    # F: 331-420
    # G: > 420
    classes = []
    for sc in specific_cons:
        if sc <= 70:
            classes.append('A')
        elif sc <= 110:
            classes.append('B')
        elif sc <= 180:
            classes.append('C')
        elif sc <= 250:
            classes.append('D')
        elif sc <= 330:
            classes.append('E')
        elif sc <= 420:
            classes.append('F')
        else:
            classes.append('G')
            
    # Create DataFrame
    df = pd.DataFrame({
        'surface': np.round(surface, 1),
        'pieces': pieces,
        'age': np.round(age, 1),
        'heating_type': heating,
        'insulation': isolation,
        'occupants': occupants,
        'annual_consumption': np.round(consommation_annuelle, 1),
        'energy_class': classes
    })
    
    return df

if __name__ == '__main__':
    # Ensure data and web directories exist
    os.makedirs('data', exist_ok=True)
    os.makedirs('web', exist_ok=True)
    
    # Generate and save dataset
    df = generate_building_data(num_samples=1500)
    output_path = 'data/building_energy_data.csv'
    df.to_csv(output_path, index=False)
    print(f"Jeu de données généré et sauvegardé dans : {output_path}")
    print(f"Nombre total de lignes : {len(df)}")
    print("\nDistribution des classes énergétiques :")
    print(df['energy_class'].value_counts().sort_index())
    
    # Generate template CSV for importing real data
    # Headers: surface,pieces,age,occupants,annual_consumption,heating_type,insulation
    template_data = pd.DataFrame({
        'surface': [85.0, 45.0, 150.0, 120.0, 75.0],
        'pieces': [4, 2, 6, 5, 3],
        'age': [25, 10, 80, 3, 45],
        'occupants': [3, 1, 5, 4, 2],
        'annual_consumption': [12000.0, 4500.0, 28000.0, 4800.0, 8500.0],
        'heating_type': ['Gaz', 'Electrique', 'Fioul', 'Pompe_a_chaleur', 'Bois'],
        'insulation': ['Moyenne', 'Bonne', 'Mauvaise', 'Excellente', 'Moyenne']
    })
    
    template_path = 'web/gabarit_import_dpe.csv'
    template_data.to_csv(template_path, index=False)
    print(f"Gabarit d'importation CSV sauvegardé dans : {template_path}")
    
    print("\nAperçu des données :")
    print(df.head())
