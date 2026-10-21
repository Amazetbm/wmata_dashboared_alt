import { ComponentFixture } from '@angular/core/testing';
import { TestRequest } from '@angular/common/http/testing';

export async function flushAndSettle<T>(
  req: TestRequest,
  body: T,
  fixture: ComponentFixture<any>
): Promise<void> {
  req.flush(body);
  await fixture.whenStable();
}

export async function flushError(
  req: TestRequest,
  fixture: ComponentFixture<any>,
  status = 500
): Promise<void> {
  req.flush({ error: 'Server error' }, { status, statusText: 'Error' });
  await fixture.whenStable();
}
