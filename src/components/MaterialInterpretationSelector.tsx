import React from 'react';
import { useStudyMode, InterpretationMode, StudyModeSettings } from '../contexts/StudyModeContext';

interface Props {
  subjectId: string;
}

export const MaterialInterpretationSelector: React.FC<Props> = ({ subjectId }) => {
  const { getSettings, updateSettings } = useStudyMode();
  const settings = getSettings(subjectId);

  const handleChange = (key: keyof StudyModeSettings, value: InterpretationMode) => {
    updateSettings(subjectId, { ...settings, [key]: value });
  };

  const modes: { label: string; value: InterpretationMode; desc: string }[] = [
    { label: '선별 모드 (Selective)', value: 'PASSIVE', desc: '자료 범위 > 시험 범위 (불필요 내용 제거)' },
    { label: '기준 모드 (Core)', value: 'ACTIVE', desc: '자료 범위 ≒ 시험 범위 (통합의 구심점)' },
    { label: '보조 모드 (Supplement)', value: 'EXTENSIVE', desc: '자료 범위 < 시험 범위 (부분적 참고 자료)' },
  ];

  return (
    <div className="bg-white dark:bg-neutral-900 rounded-xl border border-neutral-200 dark:border-neutral-800 shadow-sm p-5 space-y-4 transition-colors duration-200">
      <h3 className="font-semibold text-sm text-neutral-700 dark:text-neutral-300">
        자료별 해석 모드
      </h3>
      <div className="grid grid-cols-1 gap-4">
        {(['lecture', 'recording', 'exam'] as const).map((key) => (
          <div key={key} className="space-y-2">
            <label className="text-xs font-medium text-neutral-600 dark:text-neutral-400 capitalize">
              {key === 'exam' ? '기출문제' : key === 'lecture' ? '강의자료' : '녹음본'}
            </label>
            <div className="grid grid-cols-1 gap-2">
              {modes.map(mode => (
                <label
                  key={mode.value}
                  className={`relative flex cursor-pointer rounded-lg border p-2 shadow-sm focus:outline-none transition-colors duration-200 ${
                    settings[key] === mode.value
                      ? "border-blue-600 dark:border-blue-500 bg-blue-50/50 dark:bg-blue-900/20"
                      : "border-neutral-200 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800/50"
                  }`}
                >
                  <input
                    type="radio"
                    name={key}
                    value={mode.value}
                    checked={settings[key] === mode.value}
                    onChange={() => handleChange(key, mode.value)}
                    className="sr-only"
                  />
                  <div className="flex w-full items-center justify-between">
                    <div className="text-xs">
                      <p className={`font-medium ${settings[key] === mode.value ? "text-blue-900 dark:text-blue-300" : "text-neutral-900 dark:text-neutral-100"}`}>
                        {mode.label}
                      </p>
                      <p className={`mt-0.5 ${settings[key] === mode.value ? "text-blue-700/70 dark:text-blue-400/70" : "text-neutral-500 dark:text-neutral-400"}`}>
                        {mode.desc}
                      </p>
                    </div>
                  </div>
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
