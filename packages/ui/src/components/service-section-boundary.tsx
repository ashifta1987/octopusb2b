'use client';

import { Component, type ReactNode } from 'react';
import { ServiceSection, type ServiceSectionProps } from './service-section';

export type ServiceSectionBoundaryProps = Omit<ServiceSectionProps, 'children' | 'loading' | 'error' | 'onRetry' | 'empty'> & {
  /** Usually a <ServiceSection> (or a component that renders one). */
  children: ReactNode;
  /** Called when the user presses Try again, before the children render again (e.g. refetch). */
  onReset?: () => void;
};

/**
 * Error boundary for one Shop section: if anything inside throws while rendering, only this section turns into
 * "We couldn’t load <title>. · Try again"; the rest of the page keeps working (Part 2.10 / 5.2).
 */
export class ServiceSectionBoundary extends Component<ServiceSectionBoundaryProps, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  private retry = () => {
    this.props.onReset?.();
    this.setState({ failed: false });
  };

  render() {
    if (!this.state.failed) return this.props.children;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { children, onReset, ...section } = this.props;
    return <ServiceSection {...section} error onRetry={this.retry} />;
  }
}
