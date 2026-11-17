import { parseFaRows, guessFaColumns } from '../src/engine/faImport';
import { sampleProject } from '../src/engine/sample';

export function detailProject() {
  const p = sampleProject();
  const rows = [
    ['財產目錄'],
    ['類別', '財產名稱', '取得日期', '原始成本', '累計折舊', '殘值', '耐用年限'],
    ['房屋及建築', '總部大樓', '民國104/01/01', '50,000,000', '15,000,000', '0', '35'],
    ['機器設備', 'CNC 加工機', '2021/07/01', '30,000,000', '18,000,000', '3,000,000', '8'],
    ['機器設備', '包裝線', '', '20,000,000', '12,000,000', '0', '10'],
    ['土地', '廠房用地', '2010-03-01', '20,000,000', '', '', ''],
    ['', '合計', '', '120,000,000', '45,000,000', '', ''],
  ];
  const cols = guessFaColumns(rows[1]);
  const res = parseFaRows(rows, 1, cols, '2025-12-31');
  p.faAssets = res.assets;
  return { p, res, cols };
}

