import { useEffect, useId } from 'react';
import { desktop } from './shared.jsx';

// Each editor owns a token, so one saved form cannot clear another form's warning.
export default function useUnsaved(value, guardNavigation = false) {
  const id = useId();
  useEffect(() => {
    desktop?.setUnsaved(id, value);
    const beforeUnload = e => { e.preventDefault(); e.returnValue = ''; };
    const onNavigate = e => {
      const link = e.target.closest('a[href^="#/"]');
      if (value && guardNavigation && link && link.hash !== location.hash && !window.confirm('Leave this transcript and discard the unsaved line edit?')) { e.preventDefault(); e.stopPropagation(); }
    };
    document.addEventListener('click', onNavigate, true);
    if (value && !desktop) window.addEventListener('beforeunload', beforeUnload);
    return () => {
      desktop?.setUnsaved(id, false);
      window.removeEventListener('beforeunload', beforeUnload);
      document.removeEventListener('click', onNavigate, true);
    };
  }, [id, value, guardNavigation]);
}
