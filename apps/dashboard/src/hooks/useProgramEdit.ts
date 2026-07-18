import { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useProgramStore } from '../data/store';
import { typeToSegment } from '../lib/routes';
import type { Program, ProgramType } from '../lib/types';

export function useProgramEdit(expectedType: ProgramType): { editMode: boolean; editing: Program | null } {
  const { id } = useParams();
  const programs = useProgramStore(s => s.programs);
  const navigate = useNavigate();
  const found = id ? programs.find(p => p.id === id) ?? null : null;
  const isDraft = found?.status === 'draft';
  useEffect(() => {
    if (id && !isDraft) {
      navigate(found ? `/${typeToSegment(found.type)}/${found.id}` : `/${typeToSegment(expectedType)}`, { replace: true });
    }
  }, [id, isDraft, found, expectedType, navigate]);
  return { editMode: Boolean(id && isDraft), editing: id && isDraft ? found : null };
}
