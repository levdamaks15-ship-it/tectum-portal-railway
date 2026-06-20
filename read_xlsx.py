import zipfile
import xml.etree.ElementTree as ET

def parse_xlsx(file_path):
    with zipfile.ZipFile(file_path, 'r') as z:
        # Get shared strings
        shared_strings = []
        try:
            with z.open('xl/sharedStrings.xml') as f:
                tree = ET.parse(f)
                root = tree.getroot()
                ns = {'ns': root.tag.split('}')[0].strip('{')} if '}' in root.tag else {}
                for si in root.findall('.//ns:si', ns) if ns else root.findall('.//si'):
                    t = si.find('ns:t', ns) if ns else si.find('t')
                    if t is not None:
                        shared_strings.append(t.text)
                    else:
                        # Sometimes text is inside a <r><t> structure
                        text_parts = []
                        for t_elem in si.findall('.//ns:t', ns) if ns else si.findall('.//t'):
                            if t_elem.text:
                                text_parts.append(t_elem.text)
                        shared_strings.append(''.join(text_parts))
        except KeyError:
            pass

        # Get sheets mapping from relationships
        sheet_rId_map = {}
        with z.open('xl/workbook.xml') as f:
            tree = ET.parse(f)
            root = tree.getroot()
            ns = {'ns': root.tag.split('}')[0].strip('{')} if '}' in root.tag else {}
            sheets = root.findall('.//ns:sheet', ns) if ns else root.findall('.//sheet')
            for sheet in sheets:
                rId = sheet.attrib.get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id')
                name = sheet.attrib.get('name')
                if rId:
                    sheet_rId_map[rId] = name

        rels_map = {}
        with z.open('xl/_rels/workbook.xml.rels') as f:
            tree = ET.parse(f)
            root = tree.getroot()
            ns = {'ns': root.tag.split('}')[0].strip('{')} if '}' in root.tag else {}
            rels = root.findall('.//ns:Relationship', ns) if ns else root.findall('.//Relationship')
            for rel in rels:
                rels_map[rel.attrib.get('Id')] = rel.attrib.get('Target')

        print("Sheets in workbook:")
        sheet_targets = []
        for rId, name in sheet_rId_map.items():
            target = rels_map.get(rId)
            print(f" - {name} -> xl/{target}")
            if target:
                sheet_targets.append((name, f"xl/{target}"))
        
        # Read the worksheets
        for name, target in sheet_targets:
            print(f"\n--- Sheet: {name} ---")
            try:
                with z.open(target) as f:
                    tree = ET.parse(f)
                    root = tree.getroot()
                    ns = {'ns': root.tag.split('}')[0].strip('{')} if '}' in root.tag else {}
                    rows = root.findall('.//ns:row', ns) if ns else root.findall('.//row')
                    for row in list(rows)[:50]: # Print first 50 rows
                        row_data = []
                        for c in row.findall('.//ns:c', ns) if ns else row.findall('.//c'):
                            v = c.find('ns:v', ns) if ns else c.find('v')
                            val = v.text if v is not None else ''
                            if c.attrib.get('t') == 's' and val:
                                val = shared_strings[int(val)]
                            row_data.append(val)
                        print("\t".join(str(x) if x is not None else '' for x in row_data))
            except Exception as e:
                print("Error reading sheet:", e)

if __name__ == '__main__':
    parse_xlsx('Calculation_Engine_v1.xlsx')
