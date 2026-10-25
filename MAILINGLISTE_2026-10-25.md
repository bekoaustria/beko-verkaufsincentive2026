# Mailingliste Verkäufer:innen Incentive – Stand 25.10.2026

Bereinigte Versandliste für die Einladung zur Beko Verkaufs-Challenge 2026 – Race to Turkey
und für den Import der Händler:innen in die Plattform-Registrierung.

> **Wichtig:** Die Listen selbst (`.xlsx`, `.csv`) enthalten Kund:innendaten (E-Mail, Telefon, Adressen)
> und gehören **nicht** ins Repository. Sie werden ausschließlich über die Verwaltung der Plattform
> hochgeladen bzw. intern abgelegt.

## Dateien (nur intern, nicht im Repository)

| Datei | Inhalt |
|---|---|
| `261025_Mailingliste_Incentive_bereinigt.xlsx` | Versandliste für die Einladung: Übersicht, Elektro, Möbel, Prüfen, Nicht im Incentive |
| `Mailingliste_Registrierung_261025_v2.xlsx` | Import für die Registrierung, ein Blatt „Registrierung“, eine Zeile je Kundennummer |

## Import-Format Registrierung (wird von der Verwaltung automatisch erkannt)

| Spalte | Wird in der App verwendet als |
|---|---|
| `Kundennummer` | Kundennummer (Pflicht) |
| `Firma` | Händler:in / Firma (Pflicht) |
| `Straße`, `PLZ`, `Ort` | Adresse für die Vorbefüllung |
| `Außendienst` | Zuständige:r Außendienstmitarbeiter:in (Name wie in der Verwaltung) |
| `Kooperation` | EP, Expert, Red Zac, DKV, Service & More, Europa Möbel, MHK, MZE |
| `E-Mail`, `Telefon` | Vorbefüllung, Telefon wird von der App auf +43 formatiert |
| `Kanal`, `Einladung` | Nur Info (Elektro/Möbel, ob eine Einladung verschickt wird), von der App ignoriert |

Die Datei enthält alle Elektro- und Möbel-Fachhändler:innen ohne Auftragssperre, auch jene ohne E-Mail,
damit die Suche bei der Registrierung jede Kundennummer findet.

## Bereinigungsregeln

| Regel | Umsetzung |
|---|---|
| Dubletten | HH/AS-Zeilen je Debitor zusammengeführt |
| Elektro-Fachhandel | Segmente „Elektro Independents“, „Elektro Buying Group“ |
| Möbel-Fachhandel | Segmente „FurnitureIndependent“, „Furniture Buying Gr“ |
| Ausgeschlossen | Sanitär, Cash&Carry/Hypermärkte, Ketten, Großhandel, Versandhandel, Ausland, Blatt „Ausgeschlossen“ |
| Zur Klärung („Prüfen“) | Auftragssperre in allen Vertriebswegen, keine/ungültige E-Mail, Buchhaltungs-/Rechnungsadresse |
| Ein Konto je E-Mail | Gleiche Adresse und gleicher Kanal = ein Plattform-Konto |

## Ablauf

| Nr. | Was tun |
|---|---|
| 1 | Prüfliste vom Außendienst klären lassen (Sperren, fehlende E-Mails) |
| 2 | `Mailingliste_Registrierung_261025_v2.xlsx` unter Verwaltung › Arbeitgeber:innen › Neue Mailingliste hochladen |
| 3 | Einladung je Kanal versenden (Elektro nur Elektro-Aktionen, Möbel nur Möbel-Aktionen) |

## .gitignore – bitte ergänzen, falls noch nicht vorhanden

```
*.xlsx
*.csv
Mailingliste*
```
